import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { compile as compileMdx } from '@mdx-js/mdx';
import fg from 'fast-glob';
import { frontmatter } from 'fumadocs-core/content/md/frontmatter';
import { mdxPreset } from 'fumadocs-core/content/mdx/preset-runtime';
import { defaultStringifier } from 'fumadocs-core/mdx-plugins/stringifier';
import { getSlugs, PathUtils } from 'fumadocs-core/source';
import * as z from 'zod/mini';
import { defaultMetaSchema, defaultPageSchema, type ContentSchema, type LumeConfig } from './config.js';
import { loadLumeConfig } from './load-config.js';
import type {
  CompiledBody,
  CompiledCollection,
  CompiledContent,
  CompileDiagnostic,
  CompiledEntry,
  CompiledMeta,
} from './types.js';
import {
  assertPluginIds,
  composeOnion,
  isBuildPlugin,
  type AnyBuildPlugin,
  type BuildCollectionContext,
  type Next,
  type BuildPluginContext,
} from './plugin.js';
import { normalizeBaseUrl } from './url.js';
import { normalizeI18n, parseI18nPath, type CompiledI18nConfig } from './i18n.js';
import {
  createReferenceCollector,
  validateReferences,
  type ExtractedReference,
  type ReferenceEntry,
} from './diagnostics.js';

export interface CompileOptions {
  cwd?: string;
  config?: LumeConfig;
  resolvedCollections?: readonly ResolvedCollection[];
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

// `remarkLLMs` overrides `filterElement`, so it cannot express our non-executing
// MDX degradation or literal title/href fallback. Keep using its public stringifier primitive.
const stringifyProcessedMarkdown = defaultStringifier({
  filterElement(node) {
    switch (node.type) {
      case 'mdxjsEsm':
      case 'mdxFlowExpression':
      case 'mdxTextExpression':
      case 'html': {
        return false;
      }
      case 'mdxJsxFlowElement':
      case 'mdxJsxTextElement': {
        return 'children-only';
      }
      default: {
        return true;
      }
    }
  },
  stringify(node) {
    if (
      (node.type !== 'mdxJsxFlowElement' && node.type !== 'mdxJsxTextElement')
      || node.children.length > 0
    ) return;
    const literals = Object.fromEntries(node.attributes.flatMap((attribute) =>
      attribute.type === 'mdxJsxAttribute' && typeof attribute.value === 'string'
        ? [[attribute.name, attribute.value]]
        : []));
    const label = literals.title ?? literals.label;
    if (!label) return;
    const escapedLabel = label.replaceAll(/([\\`*_[\]<>])/g, String.raw`\$1`);
    return literals.href
      ? `[${escapedLabel}](${literals.href.replaceAll(/[\s()<>]/g, (character) => encodeURIComponent(character))})`
      : escapedLabel;
  },
});

type MarkdownTree = Parameters<typeof stringifyProcessedMarkdown>[0];
interface MarkdownProcessor { data: (key: string) => unknown }

/** Pure-Markdown degradation: drop code/expressions and unwrap JSX while preserving portable text. */
function remarkProcessedMarkdown(this: MarkdownProcessor) {
  const processor = this;
  return (tree: MarkdownTree, file: { data: Record<string, unknown> }) => {
    file.data.processedMarkdown = stringifyProcessedMarkdown.call(processor as never, tree, undefined);
  };
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
    remarkPlugins: [createReferenceCollector(collected), remarkProcessedMarkdown],
  }));
  const {structuredData} = file.data;
  if (!structuredData) throw new Error('Fumadocs mdxPreset did not produce structured data');
  const {processedMarkdown} = file.data;
  if (typeof processedMarkdown !== 'string') throw new Error('Fumadocs mdxPreset did not produce processed Markdown');
  return {
    markdown: source,
    processedMarkdown,
    code: String(file),
    toc: (file.data.toc ?? []) as CompiledBody['toc'],
    structuredData,
    references: collected.references,
    anchors: collected.anchors,
  };
}

type StableValueMode = 'artifact' | 'fingerprint';

function stableValue(
  value: unknown,
  mode: StableValueMode,
  seen = new Map<object, number>(),
): unknown {
  const isFingerprint = mode === 'fingerprint';
  if (isFingerprint && typeof value === 'function') {
    return { $function: Function.prototype.toString.call(value) };
  }
  if (isFingerprint && typeof value === 'bigint') return { $bigint: value.toString() };
  if (isFingerprint && typeof value === 'symbol') return { $symbol: String(value) };
  if (!value || typeof value !== 'object') return value;

  if (isFingerprint) {
    const existing = seen.get(value);
    if (existing !== undefined) return { $ref: existing };
    seen.set(value, seen.size);
  }
  if (isFingerprint && value instanceof Date) return { $date: value.toISOString() };
  if (isFingerprint && value instanceof RegExp) return { $regexp: value.toString() };
  if (isFingerprint && value instanceof Map) {
    return {
      $map: [...value]
        .map(([key, item]) => [stableValue(key, mode, seen), stableValue(item, mode, seen)])
        .sort(([a], [b]) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    };
  }
  if (isFingerprint && value instanceof Set) {
    return {
      $set: [...value]
        .map((item) => stableValue(item, mode, seen))
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    };
  }
  if (Array.isArray(value)) return value.map((item) => stableValue(item, mode, seen));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => mode !== 'artifact' || item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, stableValue(item, mode, seen)]),
  );
}

function digest(...values: string[]): string {
  const hash = createHash('sha256');
  for (const value of values) hash.update(value).update('\0');
  return hash.digest('hex');
}

export function serializeCompiledContent(content: CompiledContent): string {
  return `${JSON.stringify(stableValue(content, 'artifact'), null, 2)}\n`;
}

class CompileDiagnosticsError extends Error {
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

function assertUniqueSlugs(entries: CompiledEntry[], i18n?: CompiledI18nConfig) {
  const seen = new Set<string>();
  for (const entry of entries) {
    const slug = entry.slug.join('/');
    const locales = entry.locale === '$' ? i18n?.languages ?? ['$'] : [entry.locale ?? ''];
    for (const locale of locales) {
      const key = `${locale}\0${slug}`;
      if (seen.has(key)) {
        throw new Error(`Duplicate content slug in locale ${JSON.stringify(locale)}: ${slug}`);
      }
      seen.add(key);
    }
  }
}

function normalizedCollections(config: LumeConfig) {
  const collections = config.collections ?? { default: {} };
  if (Object.keys(collections).length === 0) throw new TypeError('lume-cms requires at least one collection');
  return collections;
}

export interface ResolvedCollection {
  name: string;
  root: string;
  include: string[];
  exclude: string[];
  baseUrl: string;
  i18n?: CompiledI18nConfig;
  schema: ContentSchema;
  metaSchema: ContentSchema;
  plugins: readonly AnyBuildPlugin[];
}

export function resolveCollections(cwd: string, config: LumeConfig): ResolvedCollection[] {
  const configured = normalizedCollections(config);
  return Object.keys(configured).sort().map((name) => {
    const definition = configured[name];
    const plugins = (definition.plugins ?? []).filter(isBuildPlugin);
    assertPluginIds(plugins);
    return {
      name,
      root: path.resolve(cwd, definition.root ?? 'content'),
      include: definition.include ?? ['**/*.{md,mdx,markdown}'],
      exclude: definition.exclude ?? [],
      baseUrl: normalizeBaseUrl(definition.baseUrl),
      i18n: definition.i18n ? normalizeI18n(definition.i18n) : undefined,
      schema: definition.schema ?? defaultPageSchema,
      metaSchema: definition.metaSchema ?? defaultMetaSchema,
      plugins,
    };
  });
}

async function collectionFiles(
  cwd: string,
  collections: readonly ResolvedCollection[],
) {
  const result = new Map<string, { pages: string[]; metas: string[] }>();
  const owners = new Map<string, string>();
  for (const item of collections) {
    const globOptions = {
      cwd: item.root,
      ignore: item.exclude,
      onlyFiles: true as const,
      unique: true as const,
    };
    const metaGlob = item.i18n && item.i18n.parser !== 'dir' ? 'meta{,.*}.json' : 'meta.json';
    const [relativePageFiles, discoveredMetaFiles] = await Promise.all([
      fg(item.include, globOptions),
      fg(`**/${metaGlob}`, globOptions),
    ]);
    const relativeMetas = discoveredMetaFiles.filter((contentPath) => (
      path.posix.basename(parseI18nPath(contentPath, item.i18n).path) === 'meta.json'
    )).sort();
    const metaSet = new Set(relativeMetas);
    const relativePages = relativePageFiles.filter((sourcePath) => !metaSet.has(sourcePath)).sort();
    const toSourcePath = (contentPath: string) => (
      PathUtils.slash(path.relative(cwd, path.resolve(item.root, contentPath)))
    );
    const pages = relativePages.map(toSourcePath);
    const metas = relativeMetas.map(toSourcePath);
    for (const sourcePath of [...pages, ...metas]) {
      const absolutePath = path.resolve(cwd, sourcePath);
      const owner = owners.get(absolutePath);
      if (owner) {
        throw new Error(`Content file ${sourcePath} is included by both collections ${JSON.stringify(owner)} and ${JSON.stringify(item.name)}`);
      }
      owners.set(absolutePath, item.name);
    }
    result.set(item.name, { pages, metas });
  }
  return result;
}

function relativeContentPath(contentRoot: string, absolutePath: string): string {
  return PathUtils.slash(path.relative(contentRoot, absolutePath));
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
    const detail = Error.isError(error) ? `: ${error.message}` : '';
    throw new Error(`${sourcePath}: invalid meta.json${detail}`);
  }
  // The meta schema owns shape validation, including rejecting non-objects.
  return validate(schema, value, sourcePath, 'meta.json');
}

/** Reserved fields lume-cms owns; they never reach the user's page-data schema. */
const privateFrontmatterSchema = z.object({
  draft: z._default(z.boolean('draft must be a boolean'), false),
  slug: z.optional(z.string('slug must be a string')),
});

function assertNoPrivatePageData(data: Record<string, unknown>, sourcePath: string) {
  if ('draft' in data || 'slug' in data) {
    throw new Error(`${sourcePath}: invalid frontmatter schema output: reserved private fields draft/slug are forbidden`);
  }
}

type CompileMiddleware<Context> = (
  context: Context,
  next: Next<Promise<void>>,
) => Promise<void>;

function collectCompileHooks<Context>(
  plugins: readonly AnyBuildPlugin[],
  select: (plugin: AnyBuildPlugin) => ((context: Context, next: Next<Promise<void>>) => void | Promise<void>) | undefined,
): CompileMiddleware<Context>[] {
  const hooks: CompileMiddleware<Context>[] = [];
  for (const plugin of plugins) {
    const hook = select(plugin);
    if (hook) hooks.push(async (context, next) => { await hook(context, next); });
  }
  return hooks;
}

async function compileEntry(
  raw: string,
  sourcePath: string,
  contentPath: string,
  schema: ContentSchema,
  plugins: readonly AnyBuildPlugin[],
  i18n?: CompiledI18nConfig,
): Promise<CompiledUnit> {
  const parsed = frontmatter(raw);
  const localizedPath = parseI18nPath(contentPath, i18n);
  const privateData = await validate(privateFrontmatterSchema, parsed.data, sourcePath, 'private frontmatter') as {
    draft: boolean;
    slug?: string;
  };
  const { draft: _draft, slug: _slug, ...publicFrontmatter } = parsed.data as Record<string, unknown>;
  const data = { ...await validate(schema, publicFrontmatter, sourcePath, 'frontmatter') };
  assertNoPrivatePageData(data, sourcePath);
  const slug = privateData.slug === undefined
    ? getSlugs(localizedPath.path)
    : privateData.slug.split('/').filter(Boolean);
  const extension: Record<string, unknown> = {};
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
    if (plugin.build?.entry) {
      extension[plugin.id] = await plugin.build.entry({
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
      locale: localizedPath.locale,
      path: contentPath,
      draft: privateData.draft,
      data,
      ext: extension,
      body,
    },
    references,
    anchors,
  };
}

export async function compileContent(options: CompileOptions = {}): Promise<CompiledContent> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const config = options.config ?? (await loadLumeConfig(cwd));
  const resolvedCollections = options.resolvedCollections ?? resolveCollections(cwd, config);
  const files = await collectionFiles(cwd, resolvedCollections);
  const collections: Record<string, CompiledCollection> = {};
  const fingerprint = digest(
    'lume-cms-compile-cache-v3',
    JSON.stringify(stableValue(normalizedCollections(config), 'fingerprint')),
  );
  const {cache} = options;
  cache?.prepare(fingerprint);
  const pluginContext = { cwd, config };
  const entryPaths = new Set<string>();
  const metaPaths = new Set<string>();
  const allDiagnostics: CompileDiagnostic[] = [];
  let cachedEntries = 0;
  let compiledEntries = 0;

  for (const definition of resolvedCollections) {
    const { name, root: contentRoot, baseUrl, i18n, schema, metaSchema, plugins } = definition;
    const setup = collectCompileHooks<BuildPluginContext>(plugins, (plugin) => plugin.build?.setup);
    await composeOnion(setup, async () => {})(pluginContext);
    const entries: CompiledEntry[] = [];
    const referenceEntries: ReferenceEntry[] = [];
    const metas: CompiledMeta[] = [];
    for (const sourcePath of files.get(name)!.metas) {
      const absolutePath = path.resolve(cwd, sourcePath);
      const raw = await readFile(absolutePath, 'utf8');
      const fileDigest = digest(fingerprint, name, sourcePath, raw);
      const meta = cache?.getMeta(sourcePath, fileDigest) ?? {
        path: relativeContentPath(contentRoot, absolutePath),
        locale: parseI18nPath(relativeContentPath(contentRoot, absolutePath), i18n).locale,
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
        unit = await compileEntry(raw, sourcePath, contentPath, schema, plugins, i18n);
        cache?.setEntry(sourcePath, fileDigest, unit);
        compiledEntries += 1;
      }
      entryPaths.add(sourcePath);
      entries.push(unit.entry);
      referenceEntries.push({ sourcePath, ...unit });
    }

    entries.sort((a, b) => (
      (a.locale ?? '').localeCompare(b.locale ?? '')
      || a.slug.join('/').localeCompare(b.slug.join('/'))
      || a.path.localeCompare(b.path)
    ));
    assertUniqueSlugs(entries, i18n);
    const collection = collectCompileHooks<BuildCollectionContext>(
      plugins,
      (plugin) => plugin.build?.collection,
    );
    await composeOnion(collection, async () => {})({ ...pluginContext, entries });
    const diagnostics = await validateReferences(cwd, referenceEntries, baseUrl, i18n);
    allDiagnostics.push(...diagnostics);
    collections[name] = {
      baseUrl,
      i18n,
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
