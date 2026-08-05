import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { compile as compileMdxSource, type CompileOptions as MdxCompileOptions } from '@mdx-js/mdx';
import { fromZonedTime } from 'date-fns-tz';
import fg from 'fast-glob';
import matter from 'gray-matter';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';
import { visit } from 'unist-util-visit';
import * as v from 'valibot';
import { parse as parseYaml } from 'yaml';
import { defaultFrontmatterSchema, loadLumeConfig, type LumeConfig } from './config.js';
import type { CompiledContent, CompiledEntry, TocItem } from './types.js';

const OFFSET_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const PLAIN_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface CompileOptions {
  cwd?: string;
  config?: LumeConfig;
  write?: boolean;
}

function parsePublishDate(value: unknown, sourcePath: string, timezone?: string) {
  if (value === undefined || value === null) return { publishDate: null, publishAtMs: null };
  if (typeof value !== 'string') {
    throw new Error(`${sourcePath}: publishDate must be an ISO 8601 string with Z or an offset`);
  }

  let date: Date;
  if (OFFSET_DATE_TIME.test(value)) {
    date = new Date(value);
  } else if (PLAIN_DATE.test(value) && timezone) {
    date = fromZonedTime(`${value}T00:00:00`, timezone);
  } else {
    const timezoneHint = timezone ? '' : ' (or configure defaultTimezone for a plain date)';
    throw new Error(`${sourcePath}: invalid publishDate ${JSON.stringify(value)}; expected ISO 8601 with Z or an offset${timezoneHint}`);
  }

  if (!Number.isFinite(date.getTime())) {
    throw new Error(`${sourcePath}: invalid publishDate ${JSON.stringify(value)}`);
  }
  return { publishDate: value, publishAtMs: date.getTime() };
}

function textOf(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const value = (node as { value?: unknown }).value;
  if (typeof value === 'string') return value;
  const children = (node as { children?: unknown[] }).children;
  return children?.map(textOf).join('') ?? '';
}

function slugify(input: string): string {
  return input.toLowerCase().trim().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-').replace(/-+/g, '-');
}

async function compileMarkdown(markdown: string) {
  const parser = unified().use(remarkParse);
  const tree = parser.parse(markdown);
  const toc: TocItem[] = [];
  const counts = new Map<string, number>();
  visit(tree, 'heading', (node: { depth: number; children?: unknown[] }) => {
    const title = textOf(node);
    const base = slugify(title);
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    toc.push({ title, url: `#${count ? `${base}-${count}` : base}`, depth: node.depth });
  });
  const html = String(await unified().use(remarkParse).use(remarkRehype).use(rehypeStringify).process(markdown));
  return { format: 'markdown' as const, markdown, html, toc };
}

function collectToc(toc: TocItem[]): NonNullable<MdxCompileOptions['remarkPlugins']>[number] {
  return () => (tree) => {
    const counts = new Map<string, number>();
    visit(tree, 'heading', (node: { depth: number; children?: unknown[] }) => {
      const title = textOf(node);
      const base = slugify(title);
      const count = counts.get(base) ?? 0;
      counts.set(base, count + 1);
      toc.push({ title, url: `#${count ? `${base}-${count}` : base}`, depth: node.depth });
    });
  };
}

async function compileMdx(mdx: string) {
  const toc: TocItem[] = [];
  const code = String(await compileMdxSource(mdx, {
    outputFormat: 'function-body',
    development: false,
    remarkPlugins: [collectToc(toc)],
  }));
  return { format: 'mdx' as const, markdown: mdx, html: '', code, toc };
}

function relativeSlug(sourcePath: string, root: string): string[] {
  let value = path.relative(root, sourcePath).replace(/\\/g, '/').replace(/\.(md|mdx|markdown|json)$/i, '');
  if (value.endsWith('/index')) value = value.slice(0, -'/index'.length);
  return value.split('/').filter(Boolean);
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

export function serializeCompiledContent(content: CompiledContent): string {
  return `${JSON.stringify(stableValue(content), null, 2)}\n`;
}

export async function compileContent(options: CompileOptions = {}): Promise<CompiledContent> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const config = options.config ?? (await loadLumeConfig(cwd));
  const contentRoot = path.resolve(cwd, config.content?.root ?? 'content');
  const include = config.content?.include ?? ['content/**/*.{md,mdx,markdown,json}'];
  const files = await fg(include, {
    cwd,
    ignore: config.content?.exclude,
    onlyFiles: true,
    unique: true,
  });
  const schema = config.content?.schema ?? defaultFrontmatterSchema;
  const entries: CompiledEntry[] = [];

  for (const relativePath of files.sort()) {
    const absolutePath = path.resolve(cwd, relativePath);
    const raw = await readFile(absolutePath, 'utf8');
    const extension = path.extname(relativePath).toLowerCase();
    const candidates: Array<{ data: unknown; markdown: string; suffix?: number }> = [];
    if (extension === '.json') {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch (error) {
        throw new Error(`${relativePath}: invalid JSON: ${(error as Error).message}`);
      }
      for (const [index, item] of (Array.isArray(parsed) ? parsed : [parsed]).entries()) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          throw new Error(`${relativePath}: JSON content must be an object or an array of objects`);
        }
        const { body = '', ...data } = item as Record<string, unknown>;
        if (typeof body !== 'string') throw new Error(`${relativePath}: body must be a Markdown string`);
        candidates.push({ data, markdown: body, suffix: Array.isArray(parsed) ? index + 1 : undefined });
      }
    } else {
      const parsed = matter(raw, {
        engines: { yaml: (source) => parseYaml(source) as Record<string, unknown> },
      });
      candidates.push({ data: parsed.data, markdown: parsed.content });
    }

    for (const candidate of candidates) {
      const result = v.safeParse(schema, candidate.data);
      if (!result.success) {
        const details = result.issues.map((issue) => issue.message).join('; ');
        throw new Error(`${relativePath}: invalid frontmatter: ${details}`);
      }
      const data = result.output;
      const configuredSlug = typeof data.slug === 'string' ? data.slug.split('/').filter(Boolean) : undefined;
      const slug = configuredSlug ?? [
        ...relativeSlug(absolutePath, contentRoot),
        ...(candidate.suffix ? [String(candidate.suffix)] : []),
      ];
      if (slug.length === 0) throw new Error(`${relativePath}: content slug cannot be empty`);
      const dates = parsePublishDate(data.publishDate, relativePath, config.defaultTimezone);
      entries.push({
        id: slug.join('/'),
        slug,
        sourcePath: relativePath.replace(/\\/g, '/'),
        ...dates,
        draft: data.draft === true,
        data,
        body: extension === '.mdx' ? await compileMdx(candidate.markdown) : await compileMarkdown(candidate.markdown),
      });
    }
  }

  entries.sort((a, b) => a.id.localeCompare(b.id));
  const duplicates = entries.filter((entry, index) => index > 0 && entry.id === entries[index - 1]?.id);
  if (duplicates.length) throw new Error(`Duplicate content slug: ${duplicates[0]?.id}`);
  const content: CompiledContent = { schemaVersion: 1, entries };

  if (options.write !== false) {
    const output = path.resolve(cwd, config.output ?? 'content.generated.json');
    await writeFile(output, serializeCompiledContent(content), 'utf8');
  }
  return content;
}
