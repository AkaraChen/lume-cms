import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { compile as compileMdx } from '@mdx-js/mdx';
import fg from 'fast-glob';
import { frontmatter } from 'fumadocs-core/content/md/frontmatter';
import { mdxPreset } from 'fumadocs-core/content/mdx/preset-runtime';
import { getSlugs } from 'fumadocs-core/source';
import {
  defaultMetaSchema,
  defaultPageSchema,
  loadLumeConfig,
  type ContentSchema,
  type LumeConfig,
} from './config.js';
import type {
  CompiledBody,
  CompiledCollection,
  CompiledContent,
  CompileDiagnostic,
  CompiledEntry,
  CompiledMeta,
} from './types.js';
import { assertPluginIds, type AnyLumePlugin } from './plugin.js';
import { normalizeBaseUrl } from './url.js';
import {
  createReferenceCollector,
  validateReferences,
  type ExtractedReference,
  type ReferenceEntry,
} from './diagnostics.js';

export interface CompileOptions {
  cwd?: string;
  config?: LumeConfig;
  cache?: CompileCache;
  strict?: boolean;
  write?: boolean;
}

interface CompiledUnit {
  entry: CompiledEntry;
  references: ExtractedReference[];
  anchors: string[];
}

interface CachedEntry {
  digest: string;
  value: CompiledUnit;
}

interface CachedMeta {
  digest: string;
  value: CompiledMeta;
}

export interface CompileStats {
  cachedEntries: number;
  compiledEntries: number;
}

export class CompileCache {
  private fingerprint = '';
  private readonly entries = new Map<string, CachedEntry>();
  private readonly metas = new Map<string, CachedMeta>();
  stats: CompileStats = { cachedEntries: 0, compiledEntries: 0 };

  prepare(fingerprint: string) {
    if (this.fingerprint === fingerprint) return;
    this.fingerprint = fingerprint;
    this.entries.clear();
    this.metas.clear();
  }

  getEntry(path: string, digest: string): CompiledUnit | undefined {
    const cached = this.entries.get(path);
    if (cached?.digest !== digest) return;
    return structuredClone(cached.value);
  }

  setEntry(path: string, digest: string, value: CompiledUnit) {
    this.entries.set(path, { digest, value: structuredClone(value) });
  }

  getMeta(path: string, digest: string): CompiledMeta | undefined {
    const cached = this.metas.get(path);
    if (cached?.digest !== digest) return;
    return structuredClone(cached.value);
  }

  setMeta(path: string, digest: string, value: CompiledMeta) {
    this.metas.set(path, { digest, value: structuredClone(value) });
  }

  prune(entryPaths: Set<string>, metaPaths: Set<string>) {
    for (const path of this.entries.keys()) if (!entryPaths.has(path)) this.entries.delete(path);
    for (const path of this.metas.keys()) if (!metaPaths.has(path)) this.metas.delete(path);
  }
}

async function compileBody(source: string): Promise<CompiledBody & {
  references: ExtractedReference[];
  anchors: string[];
}> {
  const collected = { references: [], anchors: [] } satisfies {
    references: ExtractedReference[];
    anchors: string[];
  };
  const file = await compileMdx(source, await mdxPreset({
    development: false,
    remarkHeadingOptions: { generateToc: true },
    remarkImageOptions: { useImport: false },
    remarkPlugins: [createReferenceCollector(collected)],
  }));
  const structuredData = file.data.structuredData;
  if (!structuredData) throw new Error('Fumadocs mdxPreset did not produce structured data');
  return {
    markdown: source,
    code: String(file),
    toc: (file.data.toc ?? []) as CompiledBody['toc'],
    structuredData,
    references: collected.references,
    anchors: collected.anchors,
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

function fingerprintValue(value: unknown, seen = new Map<object, number>()): unknown {
  if (typeof value === 'function') return { $function: Function.prototype.toString.call(value) };
  if (typeof value === 'bigint') return { $bigint: value.toString() };
  if (typeof value === 'symbol') return { $symbol: String(value) };
  if (!value || typeof value !== 'object') return value;

  const existing = seen.get(value);
  if (existing !== undefined) return { $ref: existing };
  seen.set(value, seen.size);
  if (value instanceof Date) return { $date: value.toISOString() };
  if (value instanceof RegExp) return { $regexp: value.toString() };
  if (value instanceof Map) {
    return {
      $map: [...value.entries()]
        .map(([key, item]) => [fingerprintValue(key, seen), fingerprintValue(item, seen)])
        .sort(([a], [b]) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    };
  }
  if (value instanceof Set) {
    return {
      $set: [...value]
        .map((item) => fingerprintValue(item, seen))
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    };
  }
  if (Array.isArray(value)) return value.map((item) => fingerprintValue(item, seen));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, fingerprintValue(item, seen)]),
  );
}

function digest(...values: string[]): string {
  const hash = createHash('sha256');
  for (const value of values) hash.update(value).update('\0');
  return hash.digest('hex');
}

export function serializeCompiledContent(content: CompiledContent): string {
  return `${JSON.stringify(stableValue(content), null, 2)}\n`;
}

export class CompileDiagnosticsError extends Error {
  constructor(public readonly diagnostics: CompileDiagnostic[]) {
    super(`Content reference validation failed with ${diagnostics.length} diagnostic${diagnostics.length === 1 ? '' : 's'}`);
    this.name = 'CompileDiagnosticsError';
  }
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

async function parseMeta(
  raw: string,
  sourcePath: string,
  schema: ContentSchema,
): Promise<CompiledMeta['data']> {
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
  return await validate(schema, value, sourcePath, 'meta.json') as CompiledMeta['data'];
}

function privateFrontmatter(value: unknown, sourcePath: string): { draft: boolean; slug?: string } {
  const data = value as Record<string, unknown>;
  if (data.draft !== undefined && typeof data.draft !== 'boolean') {
    throw new Error(`${sourcePath}: invalid private frontmatter: draft must be a boolean`);
  }
  if (data.slug !== undefined && typeof data.slug !== 'string') {
    throw new Error(`${sourcePath}: invalid private frontmatter: slug must be a string`);
  }
  return { draft: data.draft === true, slug: data.slug as string | undefined };
}

function assertNoPrivatePageData(data: Record<string, unknown>, sourcePath: string) {
  if ('draft' in data || 'slug' in data) {
    throw new Error(`${sourcePath}: invalid frontmatter schema output: reserved private fields draft/slug are forbidden`);
  }
}

async function compileEntry(
  raw: string,
  sourcePath: string,
  contentPath: string,
  schema: ContentSchema,
  plugins: readonly AnyLumePlugin[],
): Promise<CompiledUnit> {
  const parsed = frontmatter(raw);
  const privateData = privateFrontmatter(parsed.data, sourcePath);
  const { draft: _draft, slug: _slug, ...publicFrontmatter } = parsed.data as Record<string, unknown>;
  const data = { ...await validate(schema, publicFrontmatter, sourcePath, 'frontmatter') };
  assertNoPrivatePageData(data, sourcePath);
  const slug = privateData.slug !== undefined
    ? privateData.slug.split('/').filter(Boolean)
    : getSlugs(contentPath);
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
  const { references, anchors, ...body } = await compileBody(parsed.content);
  return {
    entry: {
      slug,
      path: contentPath,
      draft: privateData.draft,
      data,
      ext,
      body,
    },
    references,
    anchors,
  };
}

export async function compileContent(options: CompileOptions = {}): Promise<CompiledContent> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const config = options.config ?? (await loadLumeConfig(cwd));
  const configured = normalizedCollections(config);
  const files = await collectionFiles(cwd, configured);
  const collections: Record<string, CompiledCollection> = {};
  const fingerprint = digest('lume-cms-compile-cache-v2', JSON.stringify(fingerprintValue({
    collections: configured,
    plugins: config.plugins,
  })));
  const cache = options.cache;
  cache?.prepare(fingerprint);
  const pluginContext = { cwd, config };
  const entryPaths = new Set<string>();
  const metaPaths = new Set<string>();
  const allDiagnostics: CompileDiagnostic[] = [];
  let cachedEntries = 0;
  let compiledEntries = 0;

  for (const name of Object.keys(configured).sort()) {
    const definition = configured[name]!;
    const baseUrl = normalizeBaseUrl(definition.baseUrl);
    const contentRoot = path.resolve(cwd, definition.root ?? 'content');
    const schema = definition.schema ?? defaultPageSchema;
    const metaSchema = definition.metaSchema ?? defaultMetaSchema;
    const plugins = definition.plugins ?? config.plugins ?? [];
    assertPluginIds(plugins);
    for (const plugin of plugins) await plugin.compile?.setup?.(pluginContext);
    const entries: CompiledEntry[] = [];
    const referenceEntries: ReferenceEntry[] = [];
    const metas: CompiledMeta[] = [];
    for (const sourcePath of files.get(name)!.metas) {
      const absolutePath = path.resolve(cwd, sourcePath);
      const raw = await readFile(absolutePath, 'utf8');
      const fileDigest = digest(fingerprint, name, sourcePath, raw);
      const meta = cache?.getMeta(sourcePath, fileDigest) ?? {
        path: relativeContentPath(contentRoot, absolutePath),
        data: await parseMeta(raw, sourcePath, metaSchema),
      };
      cache?.setMeta(sourcePath, fileDigest, meta);
      metaPaths.add(sourcePath);
      metas.push(meta);
    }

    for (const sourcePath of files.get(name)!.pages) {
      const absolutePath = path.resolve(cwd, sourcePath);
      const contentPath = relativeContentPath(contentRoot, absolutePath);
      const raw = await readFile(absolutePath, 'utf8');
      const fileDigest = digest(fingerprint, name, sourcePath, raw);
      let unit = cache?.getEntry(sourcePath, fileDigest);
      if (unit) cachedEntries += 1;
      else {
        unit = await compileEntry(raw, sourcePath, contentPath, schema, plugins);
        cache?.setEntry(sourcePath, fileDigest, unit);
        compiledEntries += 1;
      }
      entryPaths.add(sourcePath);
      entries.push(unit.entry);
      referenceEntries.push({ sourcePath, ...unit });
    }

    entries.sort((a, b) => a.slug.join('/').localeCompare(b.slug.join('/')));
    assertUniqueSlugs(entries);
    for (const plugin of plugins) await plugin.compile?.finalize?.(entries, pluginContext);
    const diagnostics = await validateReferences(cwd, referenceEntries, baseUrl);
    allDiagnostics.push(...diagnostics);
    collections[name] = {
      baseUrl,
      plugins: plugins.map((plugin) => plugin.id),
      entries,
      metas,
      diagnostics,
    };
  }

  cache?.prune(entryPaths, metaPaths);
  if (cache) cache.stats = { cachedEntries, compiledEntries };
  if (options.strict && allDiagnostics.length > 0) throw new CompileDiagnosticsError(allDiagnostics);
  const content: CompiledContent = { schemaVersion: 3, collections };
  if (options.write !== false) {
    await writeFile(path.resolve(cwd, config.output ?? 'content.generated.json'), serializeCompiledContent(content), 'utf8');
  }
  return content;
}
