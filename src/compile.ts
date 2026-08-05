import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { compile as compileMdx } from '@mdx-js/mdx';
import { fromZonedTime } from 'date-fns-tz';
import fg from 'fast-glob';
import {
  rehypeCode,
  rehypeToc,
  remarkGfm,
  remarkHeading,
  remarkImage,
  remarkNpm,
  structure,
} from 'fumadocs-core/mdx-plugins';
import matter from 'gray-matter';
import type { Pluggable } from 'unified';
import { parse as parseYaml } from 'yaml';
import {
  defaultFrontmatterSchema,
  defaultMetaSchema,
  loadLumeConfig,
  type ContentSchema,
  type LumeConfig,
  type PluginOption,
} from './config.js';
import type { CompiledBody, CompiledContent, CompiledEntry, CompiledMeta } from './types.js';

const OFFSET_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const PLAIN_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CONTENT_EXTENSION = /\.(md|mdx|markdown|json)$/i;

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
    const hint = timezone ? '' : ' (or configure defaultTimezone for a plain date)';
    throw new Error(`${sourcePath}: invalid publishDate ${JSON.stringify(value)}; expected ISO 8601 with Z or an offset${hint}`);
  }

  if (!Number.isFinite(date.getTime())) {
    throw new Error(`${sourcePath}: invalid publishDate ${JSON.stringify(value)}`);
  }
  return { publishDate: value, publishAtMs: date.getTime() };
}

function textOf(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const { value, children } = node as { value?: unknown; children?: unknown[] };
  if (typeof value === 'string') return value;
  return children?.map(textOf).join('') ?? '';
}

/** Append extra plugins, or hand the official defaults to a function for full control. */
function resolvePlugins(defaults: Pluggable[], configured?: PluginOption): Pluggable[] {
  if (typeof configured === 'function') return configured(defaults);
  return configured ? [...defaults, ...configured] : defaults;
}

/**
 * One pipeline for Markdown and MDX, matching the `fumadocs-mdx` default preset.
 * Headings ids, the table of contents and syntax highlighting all come from Fumadocs.
 */
async function compileBody(source: string, config: LumeConfig): Promise<CompiledBody> {
  const remarkPlugins = resolvePlugins(
    [remarkGfm, [remarkHeading, { generateToc: false }], [remarkImage, { useImport: false }], remarkNpm],
    config.remarkPlugins,
  );
  const file = await compileMdx(source, {
    outputFormat: 'function-body',
    development: false,
    remarkPlugins,
    rehypePlugins: resolvePlugins([rehypeCode, [rehypeToc, { exportToc: { as: 'data' } }]], config.rehypePlugins),
  });
  const toc = (file.data.rehypeToc ?? []).map((item) => ({
    title: textOf(item.title),
    url: item.url,
    depth: item.depth,
  }));
  // `structure` runs synchronously, so it only takes the sync subset of the pipeline.
  return { markdown: source, code: String(file), toc, structuredData: structure(source, [remarkGfm]) };
}

function relativeSlug(sourcePath: string, root: string): string[] {
  const value = path.relative(root, sourcePath).replace(/\\/g, '/').replace(CONTENT_EXTENSION, '');
  return value.replace(/(^|\/)index$/, '').split('/').filter(Boolean);
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

async function validate(schema: ContentSchema, value: unknown, sourcePath: string, kind: string) {
  const result = await schema['~standard'].validate(value);
  if (result.issues) {
    throw new Error(`${sourcePath}: invalid ${kind}: ${result.issues.map((issue) => issue.message).join('; ')}`);
  }
  return result.value;
}

function parseJson(raw: string, sourcePath: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`${sourcePath}: invalid JSON: ${(error as Error).message}`);
  }
}

/** A source file yields one candidate, except a JSON array which yields one per item. */
function readCandidates(raw: string, sourcePath: string, isJson: boolean) {
  if (!isJson) {
    const parsed = matter(raw, { engines: { yaml: (source) => parseYaml(source) as Record<string, unknown> } });
    return [{ data: parsed.data as unknown, markdown: parsed.content, suffix: undefined as number | undefined }];
  }

  const parsed = parseJson(raw, sourcePath);
  const items = Array.isArray(parsed) ? parsed : [parsed];
  return items.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`${sourcePath}: JSON content must be an object or an array of objects`);
    }
    const { body = '', ...data } = item as Record<string, unknown>;
    if (typeof body !== 'string') throw new Error(`${sourcePath}: body must be a Markdown string`);
    return { data: data as unknown, markdown: body, suffix: Array.isArray(parsed) ? index + 1 : undefined };
  });
}

export async function compileContent(options: CompileOptions = {}): Promise<CompiledContent> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const config = options.config ?? (await loadLumeConfig(cwd));
  const contentRoot = path.resolve(cwd, config.content?.root ?? 'content');
  const schema = config.content?.schema ?? defaultFrontmatterSchema;
  const metaSchema = config.content?.metaSchema ?? defaultMetaSchema;
  const files = await fg(config.content?.include ?? ['content/**/*.{md,mdx,markdown,json}'], {
    cwd,
    ignore: config.content?.exclude,
    onlyFiles: true,
    unique: true,
  });

  const entries: CompiledEntry[] = [];
  const metas: CompiledMeta[] = [];

  for (const sourcePath of files.sort()) {
    const absolutePath = path.resolve(cwd, sourcePath);
    const contentPath = path.relative(contentRoot, absolutePath).replace(/\\/g, '/');
    const raw = await readFile(absolutePath, 'utf8');
    const isJson = path.extname(sourcePath).toLowerCase() === '.json';

    if (isJson && path.basename(sourcePath).toLowerCase() === 'meta.json') {
      const data = await validate(metaSchema, parseJson(raw, sourcePath), sourcePath, 'metadata');
      metas.push({ path: contentPath, data });
      continue;
    }

    for (const candidate of readCandidates(raw, sourcePath, isJson)) {
      const data = await validate(schema, candidate.data, sourcePath, 'frontmatter');
      const slug = typeof data.slug === 'string'
        ? data.slug.split('/').filter(Boolean)
        : [...relativeSlug(absolutePath, contentRoot), ...(candidate.suffix ? [String(candidate.suffix)] : [])];
      entries.push({
        id: slug.join('/') || 'index',
        slug,
        path: contentPath,
        ...parsePublishDate(data.publishDate, sourcePath, config.defaultTimezone),
        draft: data.draft === true,
        data,
        body: await compileBody(candidate.markdown, config),
      });
    }
  }

  entries.sort((a, b) => a.id.localeCompare(b.id));
  const duplicate = entries.find((entry, index) => index > 0 && entry.id === entries[index - 1]?.id);
  if (duplicate) throw new Error(`Duplicate content slug: ${duplicate.id}`);
  metas.sort((a, b) => a.path.localeCompare(b.path));

  const content: CompiledContent = { schemaVersion: 1, entries, metas };
  if (options.write !== false) {
    await writeFile(path.resolve(cwd, config.output ?? 'content.generated.json'), serializeCompiledContent(content), 'utf8');
  }
  return content;
}
