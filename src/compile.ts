import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { compile as compileMdx } from '@mdx-js/mdx';
import fg from 'fast-glob';
import { frontmatter } from 'fumadocs-core/content/md/frontmatter';
import { mdxPreset } from 'fumadocs-core/content/mdx/preset-runtime';
import { getSlugs } from 'fumadocs-core/source';
import {
  defaultFrontmatterSchema,
  loadLumeConfig,
  type ContentSchema,
  type LumeConfig,
} from './config.js';
import type { CompiledBody, CompiledContent, CompiledEntry } from './types.js';
import { assertPluginIds } from './plugin.js';

export interface CompileOptions {
  cwd?: string;
  config?: LumeConfig;
  write?: boolean;
}

async function compileBody(source: string): Promise<CompiledBody> {
  const file = await compileMdx(source, await mdxPreset({
    development: false,
    remarkHeadingOptions: { generateToc: true },
    remarkImageOptions: { useImport: false },
  }));
  const structuredData = file.data.structuredData;
  if (!structuredData) throw new Error('Fumadocs mdxPreset did not produce structured data');
  return {
    markdown: source,
    code: String(file),
    toc: (file.data.toc ?? []) as CompiledBody['toc'],
    structuredData,
  };
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

function assertUniqueSlugs(entries: CompiledEntry[]) {
  const seen = new Set<string>();
  for (const entry of entries) {
    const slug = entry.slug.join('/');
    if (seen.has(slug)) throw new Error(`Duplicate content slug: ${slug}`);
    seen.add(slug);
  }
}

export async function compileContent(options: CompileOptions = {}): Promise<CompiledContent> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const config = options.config ?? (await loadLumeConfig(cwd));
  const contentRoot = path.resolve(cwd, config.content?.root ?? 'content');
  const schema = config.content?.schema ?? defaultFrontmatterSchema;
  const plugins = config.plugins ?? [];
  assertPluginIds(plugins);
  const pluginContext = { cwd, config };
  for (const plugin of plugins) await plugin.compile?.setup?.(pluginContext);
  const files = await fg(config.content?.include ?? ['content/**/*.{md,mdx,markdown}'], {
    cwd,
    ignore: config.content?.exclude,
    onlyFiles: true,
    unique: true,
  });

  const entries: CompiledEntry[] = [];

  for (const sourcePath of files.sort()) {
    const absolutePath = path.resolve(cwd, sourcePath);
    const contentPath = path.relative(contentRoot, absolutePath).replace(/\\/g, '/');
    const raw = await readFile(absolutePath, 'utf8');
    const parsed = frontmatter(raw);
    const data = { ...await validate(schema, parsed.data, sourcePath, 'frontmatter') };
    const slug = typeof data.slug === 'string' ? data.slug.split('/').filter(Boolean) : getSlugs(contentPath);
    const ext: Record<string, unknown> = {};
    for (const plugin of plugins) {
      let pluginFrontmatter: Record<string, unknown> = {};
      if (plugin.frontmatter) {
        pluginFrontmatter = await validate(
          plugin.frontmatter.schema,
          parsed.data,
          sourcePath,
          `${plugin.id} plugin frontmatter`,
        );
        for (const key of Object.keys(pluginFrontmatter)) delete data[key];
      }
      if (plugin.compile?.entry) {
        ext[plugin.id] = await plugin.compile.entry({
          sourcePath,
          contentPath,
          slug,
          frontmatter: pluginFrontmatter,
          rawFrontmatter: parsed.data as Record<string, unknown>,
        });
      }
    }
    entries.push({
      slug,
      path: contentPath,
      draft: data.draft === true,
      data,
      ext,
      body: await compileBody(parsed.content),
    });
  }

  entries.sort((a, b) => a.slug.join('/').localeCompare(b.slug.join('/')));
  assertUniqueSlugs(entries);
  for (const plugin of plugins) await plugin.compile?.finalize?.(entries, pluginContext);

  const content: CompiledContent = { schemaVersion: 2, plugins: plugins.map((plugin) => plugin.id), entries };
  if (options.write !== false) {
    await writeFile(path.resolve(cwd, config.output ?? 'content.generated.json'), serializeCompiledContent(content), 'utf8');
  }
  return content;
}
