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
import type { CompiledBody, CompiledCollection, CompiledContent, CompiledEntry, CompiledMeta } from './types.js';
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

let warnedDeprecatedContent = false;

function normalizedCollections(config: LumeConfig) {
  if (config.collections && config.content) {
    throw new TypeError('Configure either `collections` or deprecated `content`, not both');
  }
  if (config.collections) {
    if (Object.keys(config.collections).length === 0) throw new TypeError('lume-cms requires at least one collection');
    return config.collections;
  }
  if (!warnedDeprecatedContent) {
    process.emitWarning('lume-cms `content` config is deprecated; migrate to `collections`', {
      code: 'LUME_CMS_DEPRECATED_CONTENT',
    });
    warnedDeprecatedContent = true;
  }
  return { default: config.content ?? {} };
}

async function collectionFiles(
  cwd: string,
  collections: Record<string, { include?: string[]; exclude?: string[]; root?: string }>,
) {
  const result = new Map<string, { pages: string[]; metas: string[] }>();
  const owners = new Map<string, string>();
  for (const name of Object.keys(collections).sort()) {
    const item = collections[name]!;
    const globOptions = {
      cwd,
      ignore: item.exclude,
      onlyFiles: true as const,
      unique: true as const,
    };
    const rootPattern = path.relative(cwd, path.resolve(cwd, item.root ?? 'content')).replace(/\\/g, '/');
    const [pageFiles, metaFiles] = await Promise.all([
      fg(item.include ?? ['content/**/*.{md,mdx,markdown}'], globOptions),
      fg(path.posix.join(rootPattern, '**/meta.json'), globOptions),
    ]);
    const metas = metaFiles.sort();
    const metaSet = new Set(metas);
    const pages = pageFiles.filter((sourcePath) => !metaSet.has(sourcePath)).sort();
    for (const sourcePath of [...pages, ...metas]) {
      const absolutePath = path.resolve(cwd, sourcePath);
      const owner = owners.get(absolutePath);
      if (owner) {
        throw new Error(`Content file ${sourcePath} is included by both collections ${JSON.stringify(owner)} and ${JSON.stringify(name)}`);
      }
      owners.set(absolutePath, name);
    }
    result.set(name, { pages, metas });
  }
  return result;
}

function relativeContentPath(contentRoot: string, absolutePath: string): string {
  return path.relative(contentRoot, absolutePath).replace(/\\/g, '/');
}

function parseMeta(raw: string, sourcePath: string): CompiledMeta['data'] {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    const detail = error instanceof Error ? `: ${error.message}` : '';
    throw new Error(`${sourcePath}: invalid meta.json${detail}`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${sourcePath}: invalid meta.json: expected a JSON object`);
  }
  return value as CompiledMeta['data'];
}

export async function compileContent(options: CompileOptions = {}): Promise<CompiledContent> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const config = options.config ?? (await loadLumeConfig(cwd));
  const configured = normalizedCollections(config);
  const files = await collectionFiles(cwd, configured);
  const collections: Record<string, CompiledCollection> = {};
  const pluginContext = { cwd, config };
  for (const name of Object.keys(configured).sort()) {
    const definition = configured[name]!;
    const contentRoot = path.resolve(cwd, definition.root ?? 'content');
    const schema = definition.schema ?? defaultFrontmatterSchema;
    const plugins = definition.plugins ?? config.plugins ?? [];
    assertPluginIds(plugins);
    for (const plugin of plugins) await plugin.compile?.setup?.(pluginContext);
    const entries: CompiledEntry[] = [];
    const metas: CompiledMeta[] = [];

    for (const sourcePath of files.get(name)!.metas) {
      const absolutePath = path.resolve(cwd, sourcePath);
      metas.push({
        path: relativeContentPath(contentRoot, absolutePath),
        data: parseMeta(await readFile(absolutePath, 'utf8'), sourcePath),
      });
    }

    for (const sourcePath of files.get(name)!.pages) {
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
          pluginFrontmatter = await validate(plugin.frontmatter.schema, parsed.data, sourcePath, `${plugin.id} plugin frontmatter`);
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
    collections[name] = { plugins: plugins.map((plugin) => plugin.id), entries, metas };
  }

  const content: CompiledContent = { schemaVersion: 3, collections };
  if (options.write !== false) {
    await writeFile(path.resolve(cwd, config.output ?? 'content.generated.json'), serializeCompiledContent(content), 'utf8');
  }
  return content;
}
