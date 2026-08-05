import 'server-only';

import { run } from '@mdx-js/mdx';
import { dynamicLoader } from 'fumadocs-core/source/dynamic';
import type {
  ContentStorage,
  ContentStorageMetaFile,
  ContentStoragePageFile,
  DynamicSource,
  LoaderOutput,
  LoaderOptions,
  Meta,
  MetaData,
  Page,
} from 'fumadocs-core/source';
import type { I18nConfig } from 'fumadocs-core/i18n';
import { createElement, type ComponentType } from 'react';
import * as runtime from 'react/jsx-runtime';
import type { CompiledBody, CompiledCollection, CompiledContent, CompiledEntry } from './types.js';
import {
  assertPluginIds,
  type AnyLumePlugin,
  type InferPluginData,
  type PreviewOptions,
  type RuntimeContext,
} from './plugin.js';
import { normalizeBaseUrl } from './url.js';
import { normalizeI18n, type CompiledI18nConfig } from './i18n.js';

type BodyComponent = ComponentType<{ components?: Record<string, unknown> }>;

type LumePageData<Data extends Record<string, unknown> = Record<string, unknown>> = Data & {
  title: string;
  body: BodyComponent;
  /** Original source body for authoring-aware consumers. */
  content: string;
  /** Pure Markdown for LLM, Markdown, and EPUB exports. */
  processedMarkdown: string;
  toc: CompiledBody['toc'];
  structuredData: CompiledBody['structuredData'];
};

type LumeLoaderStorage<Data extends Record<string, unknown>> = ContentStorage<
  ContentStoragePageFile<undefined, LumePageData<Data>>,
  ContentStorageMetaFile<undefined, MetaData>
>;

type LumeLoaderOptions<Data extends Record<string, unknown>> = LoaderOptions<
  LumeLoaderStorage<Data>,
  I18nConfig | undefined
>;

type InferCollectionData<Collection extends CompiledCollection> = Collection extends CompiledCollection<infer Data>
  ? Data
  : never;

type InferCollectionI18n<
  Collection extends CompiledCollection,
  RuntimeI18n extends I18nConfig | undefined,
> = Collection extends { i18n: CompiledI18nConfig }
  ? CompiledI18nConfig
  : RuntimeI18n extends I18nConfig
    ? CompiledI18nConfig
    : Collection extends { i18n?: undefined }
      ? undefined
      : CompiledI18nConfig | undefined;

type LumeLoaderOutput<
  Collection extends CompiledCollection,
  Plugins extends readonly AnyLumePlugin[],
  RuntimeI18n extends I18nConfig | undefined,
> = InferCollectionI18n<Collection, RuntimeI18n> extends infer I18n
  ? I18n extends I18nConfig
    ? LoaderOutput<{
      page: Page<undefined, LumePageData<InferCollectionData<Collection> & InferPluginData<Plugins>>>;
      meta: Meta<undefined, MetaData>;
      i18n: I18n;
      source: undefined;
    }>
    : LoaderOutput<{
      page: Page<undefined, LumePageData<InferCollectionData<Collection> & InferPluginData<Plugins>>>;
      meta: Meta<undefined, MetaData>;
      i18n: undefined;
      source: undefined;
    }>
  : never;

export interface FumadocsCollectionFactory<
  Collection extends CompiledCollection,
  Plugins extends readonly AnyLumePlugin[] = [],
  RuntimeI18n extends I18nConfig | undefined = undefined,
> {
  getSource(): Promise<LumeLoaderOutput<Collection, Plugins, RuntimeI18n>>;
  getPreviewSource(options?: PreviewOptions): Promise<LumeLoaderOutput<Collection, Plugins, RuntimeI18n>>;
}

type InferSingleCollection<Content extends CompiledContent> =
  Content['collections'][keyof Content['collections']];

export type { CompiledContent } from './types.js';
export type { PreviewOptions } from './plugin.js';

export interface FumadocsCollectionOptions<
  Data extends Record<string, unknown> = Record<string, unknown>,
  Plugins extends readonly AnyLumePlugin[] = readonly AnyLumePlugin[],
> {
  /** Compatibility fallback for schema v2 output created before baseUrl was persisted. */
  baseUrl?: string;
  /** Official Fumadocs config; checked against the compiled i18n contract when both are present. */
  i18n?: I18nConfig;
  /** Override the public URL for pages and page-tree nodes. */
  url?: LumeLoaderOptions<Data & InferPluginData<Plugins>>['url'];
  /** Override public slugs after visibility filtering; undefined falls back to compiled slugs. */
  slugs?: LumeLoaderOptions<Data & InferPluginData<Plugins>>['slugs'];
  /** Official page-tree options. `url` is owned by the top-level option to prevent drift. */
  pageTree?: Omit<NonNullable<LumeLoaderOptions<Data & InferPluginData<Plugins>>['pageTree']>, 'url'>;
  /** Resolve page, folder, separator, and link icon names. */
  icon?: LumeLoaderOptions<Data & InferPluginData<Plugins>>['icon'];
  /** lume-cms compile/runtime plugins, validated against the artifact. */
  plugins?: Plugins;
  /** Official Fumadocs `plugins` option, renamed to avoid colliding with lume-cms plugins. */
  loaderPlugins?: LumeLoaderOptions<Data & InferPluginData<Plugins>>['plugins'];
}

interface FumadocsSourcesOptions<Collections extends Record<string, FumadocsCollectionOptions<any, any>>> {
  now?: () => Date;
  collections: Collections;
}

export interface FumadocsSourceOptions<
  Data extends Record<string, unknown> = Record<string, unknown>,
  Plugins extends readonly AnyLumePlugin[] = [],
> extends FumadocsCollectionOptions<Data, Plugins> {
  now?: () => Date;
}

type PluginsOf<Option> = Option extends FumadocsCollectionOptions<any, infer Plugins>
  ? Plugins
  : [];
type RuntimeI18nOf<Option> = Option extends { i18n?: infer RuntimeI18n }
  ? Extract<RuntimeI18n, I18nConfig | undefined>
  : undefined;

/** Preserve each collection's plugin tuple while defining a nested record. */
export function collection<
  Data extends Record<string, unknown> = Record<string, unknown>,
  const Plugins extends readonly AnyLumePlugin[] = [],
>(options: FumadocsCollectionOptions<Data, Plugins>): FumadocsCollectionOptions<Data, Plugins> {
  return options;
}

/** The single visibility boundary. Every Fumadocs read path derives from its files. */
function isVisible(entry: CompiledEntry, plugins: readonly AnyLumePlugin[], context: RuntimeContext): boolean {
  return (!entry.draft || context.preview?.draft === true)
    && plugins.every((plugin) => plugin.runtime?.visible?.(entry, context) !== false);
}

function bodyComponent(body: CompiledBody): BodyComponent {
  let evaluated: Promise<BodyComponent> | undefined;
  return async function CompiledBodyContent(props) {
    evaluated ??= run(body.code, { ...runtime, baseUrl: import.meta.url }).then(
      (module) => module.default as BodyComponent,
    );
    return createElement(await evaluated, props);
  };
}

function assertCompiledContent(content: CompiledContent) {
  if (content.schemaVersion === (1 as number) || content.schemaVersion === (2 as number)) {
    throw new TypeError(`Unsupported lume-cms compiled content schema version ${content.schemaVersion}; rebuild content with a version that emits schema version 3`);
  }
  if (content.schemaVersion !== 3 || !content.collections || typeof content.collections !== 'object') {
    throw new TypeError('Unsupported lume-cms compiled content schema');
  }
}

function assertPluginMatch(compiled: CompiledCollection, plugins: readonly AnyLumePlugin[], collectionName: string) {
  assertPluginIds(plugins);
  const runtimeIds = plugins.map((plugin) => plugin.id);
  if (compiled.plugins.length === runtimeIds.length && compiled.plugins.every((id, index) => id === runtimeIds[index])) return;
  const missing = compiled.plugins.find((id) => !runtimeIds.includes(id));
  if (missing) {
    throw new TypeError(
      `Collection ${JSON.stringify(collectionName)} was compiled with plugin ${JSON.stringify(missing)}; add it to its runtime collection({ plugins })`,
    );
  }
  const extra = runtimeIds.find((id) => !compiled.plugins.includes(id));
  if (extra) {
    throw new TypeError(`Runtime plugin ${JSON.stringify(extra)} was not used to compile collection ${JSON.stringify(collectionName)}`);
  }
  throw new TypeError(`lume-cms plugins for collection ${JSON.stringify(collectionName)} must have the same compile-time and runtime order`);
}

function createCollectionSource<
  const Collection extends CompiledCollection,
  const Plugins extends readonly AnyLumePlugin[],
  const RuntimeI18n extends I18nConfig | undefined = undefined,
>(
  name: string,
  compiled: Collection,
  options: Omit<FumadocsCollectionOptions<InferCollectionData<Collection>, Plugins>, 'i18n'> & {
    i18n?: RuntimeI18n;
  },
  currentTime: () => number,
): FumadocsCollectionFactory<Collection, Plugins, RuntimeI18n> {
  type Data = InferCollectionData<Collection>;
  const plugins = options.plugins ?? [] as unknown as Plugins;
  assertPluginMatch(compiled, plugins, name);
  if (options.pageTree && 'url' in options.pageTree) {
    throw new TypeError('pageTree.url is unsupported; use the top-level url option');
  }
  const compiledBaseUrl = compiled.baseUrl === undefined ? undefined : normalizeBaseUrl(compiled.baseUrl);
  const fallbackBaseUrl = options.baseUrl === undefined ? undefined : normalizeBaseUrl(options.baseUrl);
  if (compiledBaseUrl && fallbackBaseUrl && compiledBaseUrl !== fallbackBaseUrl) {
    throw new TypeError(
      `Runtime baseUrl ${JSON.stringify(fallbackBaseUrl)} does not match compiled baseUrl ${JSON.stringify(compiledBaseUrl)} for collection ${JSON.stringify(name)}`,
    );
  }
  const baseUrl = compiledBaseUrl ?? fallbackBaseUrl ?? '/';
  const compiledI18n = compiled.i18n ? normalizeI18n(compiled.i18n) : undefined;
  const runtimeI18n = options.i18n ? normalizeI18n(options.i18n) : undefined;
  if (!compiledI18n && runtimeI18n) {
    throw new TypeError('Runtime i18n requires compiled i18n config');
  }
  if (compiledI18n && runtimeI18n && JSON.stringify(compiledI18n) !== JSON.stringify(runtimeI18n)) {
    throw new TypeError(`Runtime i18n config does not match compiled i18n config for collection ${JSON.stringify(name)}`);
  }
  const i18n = compiledI18n as InferCollectionI18n<Collection, RuntimeI18n>;
  const compiledSlugs = new Map(compiled.entries.map((entry) => [entry.path, entry.slug]));
  const loaderSlugs: LumeLoaderOptions<Data & InferPluginData<Plugins>>['slugs'] = options.slugs
    ? (file) => options.slugs?.(file) ?? compiledSlugs.get(file.path)
    : undefined;

  type SourceConfig = {
    pageData: LumePageData<Data & InferPluginData<Plugins>>;
    metaData: MetaData;
  };

  function filesAt(context: RuntimeContext): ReturnType<DynamicSource<SourceConfig>['files']> {
    return [
      ...(compiled.metas ?? []).map((meta) => ({
        type: 'meta' as const,
        path: meta.path,
        data: meta.data,
      })),
      ...compiled.entries
        .filter((entry) => isVisible(entry, plugins, context))
        .sort((a, b) => {
          for (const plugin of plugins) {
            const result = plugin.runtime?.compare?.(a, b) ?? 0;
            if (result !== 0) return result;
          }
          return (a.locale ?? '').localeCompare(b.locale ?? '')
            || a.slug.join('/').localeCompare(b.slug.join('/'));
        })
        .map((entry) => {
          const data = {
            ...entry.data,
            title: typeof entry.data.title === 'string' ? entry.data.title : entry.slug.join('/') || 'index',
            body: bodyComponent(entry.body),
            content: entry.body.markdown,
            processedMarkdown: entry.body.processedMarkdown ?? entry.body.markdown,
            toc: entry.body.toc,
            structuredData: entry.body.structuredData,
            ...Object.assign({}, ...plugins.map((plugin) => plugin.runtime?.pageData?.(entry) ?? {})),
          } as LumePageData<Data & InferPluginData<Plugins>>;
          return {
            type: 'page' as const,
            path: entry.path,
            ...(loaderSlugs ? {} : { slugs: entry.slug }),
            data,
          };
        }),
    ];
  }

  function deadlineAt(at: number) {
    return plugins.reduce(
      (next, plugin) => Math.min(next, plugin.runtime?.deadline?.(compiled.entries, { nowMs: at }) ?? Infinity),
      Infinity,
    );
  }

  function createLoader(context: RuntimeContext) {
    const source: DynamicSource<SourceConfig> = { files: () => filesAt(context) };
    return dynamicLoader(source, {
      baseUrl,
      i18n,
      url: options.url,
      slugs: loaderSlugs,
      pageTree: options.pageTree,
      icon: options.icon,
      plugins: options.loaderPlugins,
    });
  }

  type Loader = ReturnType<typeof createLoader>;
  interface Generation {
    from: number;
    until: number;
    lastUsed: number;
    value: ReturnType<Loader['get']>;
  }
  // A loader is immutable after creation. Retaining interval generations keeps
  // overlapping request-scoped clocks isolated even when they arrive out of order.
  const maxCachedGenerations = 32;
  const generations: Generation[] = [];
  let accessCounter = 0;

  function createGeneration(at: number): Generation {
    const loader = createLoader({ nowMs: at });
    return {
      from: at,
      until: deadlineAt(at),
      lastUsed: ++accessCounter,
      value: loader.get(),
    };
  }

  function getSource() {
    const at = currentTime();
    let generation = generations
      .filter((candidate) => candidate.from <= at && at < candidate.until)
      .reduce<Generation | undefined>(
        (best, candidate) => !best || candidate.from > best.from ? candidate : best,
        undefined,
      );
    if (!generation) {
      generation = createGeneration(at);
      generations.push(generation);
      if (generations.length > maxCachedGenerations) {
        const oldest = generations.reduce((a, b) => a.lastUsed < b.lastUsed ? a : b);
        generations.splice(generations.indexOf(oldest), 1);
      }
    } else {
      generation.lastUsed = ++accessCounter;
    }
    return generation.value;
  }

  function getPreviewSource(previewOptions: PreviewOptions = {}) {
    const preview = {
      draft: previewOptions.draft === true,
      future: previewOptions.future === true,
      expired: previewOptions.expired === true,
    };
    return createLoader({ nowMs: currentTime(), preview }).get();
  }

  return { getSource, getPreviewSource } as unknown as FumadocsCollectionFactory<Collection, Plugins, RuntimeI18n>;
}

export function createFumadocsSources<
  Data extends Record<string, unknown>,
  const Collections extends Record<string, FumadocsCollectionOptions<any, any>>,
>(content: CompiledContent<Data>, options: FumadocsSourcesOptions<Collections>) {
  assertCompiledContent(content);
  const compiledNames = Object.keys(content.collections).sort();
  const runtimeNames = Object.keys(options.collections).sort();
  if (compiledNames.join('\0') !== runtimeNames.join('\0')) {
    const missing = compiledNames.filter((name) => !runtimeNames.includes(name));
    const extra = runtimeNames.filter((name) => !compiledNames.includes(name));
    throw new TypeError(`Compiled and runtime collections must match exactly (missing: ${missing.join(', ') || 'none'}; extra: ${extra.join(', ') || 'none'})`);
  }

  const baseUrls = new Map<string, string>();
  for (const name of runtimeNames) {
    const compiledBaseUrl = content.collections[name]!.baseUrl;
    const runtimeBaseUrl = options.collections[name]!.baseUrl;
    const baseUrl = normalizeBaseUrl(compiledBaseUrl ?? runtimeBaseUrl);
    const existing = baseUrls.get(baseUrl);
    if (existing) throw new TypeError(`Collections ${JSON.stringify(existing)} and ${JSON.stringify(name)} use the same baseUrl ${JSON.stringify(baseUrl)}`);
    baseUrls.set(baseUrl, name);
  }

  const now = options.now ?? (() => new Date());
  function currentTime() {
    const value = now().getTime();
    if (!Number.isFinite(value)) throw new TypeError('The injected clock returned an invalid Date');
    return value;
  }

  const sources = Object.fromEntries(runtimeNames.map((name) => [
    name,
    createCollectionSource(name, content.collections[name]!, options.collections[name]!, currentTime),
  ])) as {
    [Name in keyof Collections]: FumadocsCollectionFactory<
      CompiledCollection<Data>,
      PluginsOf<Collections[Name]>,
      RuntimeI18nOf<Collections[Name]>
    >;
  };

  async function getAllSources() {
    const pairs = await Promise.all(runtimeNames.map(async (name) => [name, await sources[name]!.getSource()] as const));
    return Object.fromEntries(pairs) as {
      [Name in keyof Collections]: Awaited<ReturnType<(typeof sources)[Name]['getSource']>>;
    };
  }

  async function getAllPages() {
    const loaded = await getAllSources();
    return Object.values(loaded).flatMap((source) => source.getPages());
  }

  return { sources, getAllSources, getAllPages };
}

/** Backward-compatible single-collection facade. */
export function createFumadocsSource<
  const Content extends CompiledContent,
  const Plugins extends readonly AnyLumePlugin[] = [],
  const RuntimeI18n extends I18nConfig | undefined = undefined,
>(
  content: Content,
  options: Omit<FumadocsSourceOptions<InferCollectionData<InferSingleCollection<Content>>, Plugins>, 'i18n'> & {
    i18n?: RuntimeI18n;
  } = {},
): FumadocsCollectionFactory<InferSingleCollection<Content>, Plugins, RuntimeI18n> {
  assertCompiledContent(content);
  const names = Object.keys(content.collections);
  if (names.length !== 1) {
    throw new TypeError(`createFumadocsSource() requires exactly one compiled collection; found ${names.length}. Use createFumadocsSources().`);
  }
  const name = names[0]!;
  const compiled = content.collections[name]! as InferSingleCollection<Content>;
  const now = options.now ?? (() => new Date());
  return createCollectionSource(name, compiled, options, () => {
    const value = now().getTime();
    if (!Number.isFinite(value)) throw new TypeError('The injected clock returned an invalid Date');
    return value;
  });
}
