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
import { collection, type CollectionConfig, type LumeConfig } from './config.js';
import type { CompiledBody, CompiledCollection, CompiledContent, CompiledEntry } from './types.js';
import {
  assertPluginIds,
  composeOnion,
  isBuildPlugin,
  isRuntimePlugin,
  type AnyLumePlugin,
  type InferPluginData,
  type PreviewOptions,
  type ResolvedEntry,
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
      : undefined;

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
export { collection } from './config.js';

export type FumadocsCollectionOptions<
  Plugins extends readonly AnyLumePlugin[] = readonly AnyLumePlugin[],
> = CollectionConfig<Plugins>;

type PluginsOf<Option> = Option extends FumadocsCollectionOptions<infer Plugins>
  ? Plugins
  : [];
type RuntimeI18nOf<Option> = Option extends { i18n: infer RuntimeI18n }
  ? Extract<RuntimeI18n, I18nConfig | undefined>
  : undefined;

type ResolvedState = ResolvedEntry & {
  body: BodyComponent;
  dataPatch: Record<string, unknown>;
};
function freezeCompiled(entry: CompiledEntry): Readonly<CompiledEntry> {
  const clone = structuredClone(entry);
  const freeze = (value: unknown): void => {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return;
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  };
  freeze(clone);
  return clone;
}

function resolvedEntry(compiled: CompiledEntry, body: BodyComponent): ResolvedState {
  const hidden = new Set<string>();
  const state = new Map<string, unknown>();
  const dataPatch: Record<string, unknown> = {};
  return {
    compiled,
    body,
    hide: (reason) => hidden.add(reason),
    hidden: () => [...hidden],
    set: (key, value) => state.set(key, value),
    get: <Value = unknown>(key: string) => state.get(key) as Value | undefined,
    patchData: (patch) => Object.assign(dataPatch, patch),
    dataPatch,
  };
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
  if (content.schemaVersion !== 3 || !content.collections || typeof content.collections !== 'object') {
    throw new TypeError('Unsupported lume-cms compiled content schema');
  }
}

function assertPluginMatch(compiled: CompiledCollection, plugins: readonly AnyLumePlugin[], collectionName: string) {
  assertPluginIds(plugins);
  const buildIds = plugins.filter(isBuildPlugin).map((plugin) => plugin.id);
  if (compiled.plugins.length === buildIds.length && compiled.plugins.every((id, index) => id === buildIds[index])) return;
  const missing = compiled.plugins.find((id) => !buildIds.includes(id));
  if (missing) {
    throw new TypeError(
      `Collection ${JSON.stringify(collectionName)} was compiled with build plugin ${JSON.stringify(missing)}; add it to that collection's config`,
    );
  }
  const extra = buildIds.find((id) => !compiled.plugins.includes(id));
  if (extra) {
    throw new TypeError(`Build plugin ${JSON.stringify(extra)} was not used to compile collection ${JSON.stringify(collectionName)}`);
  }
  throw new TypeError(`lume-cms build plugins for collection ${JSON.stringify(collectionName)} changed order`);
}

function createCollectionSource<
  const Collection extends CompiledCollection,
  const Plugins extends readonly AnyLumePlugin[],
  const RuntimeI18n extends I18nConfig | undefined = undefined,
>(
  name: string,
  compiled: Collection,
  options: Omit<FumadocsCollectionOptions<Plugins>, 'i18n'> & {
    i18n?: RuntimeI18n;
  },
  currentTime: () => number,
): FumadocsCollectionFactory<Collection, Plugins, RuntimeI18n> {
  type Data = InferCollectionData<Collection>;
  const plugins = options.plugins ?? [] as unknown as Plugins;
  assertPluginMatch(compiled, plugins, name);
  const runtimePlugins = plugins.filter(isRuntimePlugin);
  const compiledPages = compiled.entries.map((entry) => {
    const frozen = freezeCompiled(entry);
    return { compiled: frozen, body: bodyComponent(frozen.body) };
  });
  const compiledEntries = compiledPages.map((page) => page.compiled);
  const hooks = runtimePlugins.map((plugin) => plugin.runtime);
  for (const [index, hook] of hooks.entries()) {
    if (hook.timeDependent && !hook.deadline) {
      throw new TypeError(`Time-dependent lume-cms plugin ${JSON.stringify(runtimePlugins[index]!.id)} must provide a deadline hook`);
    }
  }
  if (options.pageTree && 'url' in options.pageTree) {
    throw new TypeError('pageTree.url is unsupported; use the collection url option');
  }
  const baseUrl = normalizeBaseUrl(compiled.baseUrl);
  const compiledI18n = compiled.i18n ? normalizeI18n(compiled.i18n) : undefined;
  const runtimeI18n = options.i18n ? normalizeI18n(options.i18n) : undefined;
  if (!compiledI18n && runtimeI18n) {
    throw new TypeError('Runtime i18n requires compiled i18n config');
  }
  if (compiledI18n && runtimeI18n && JSON.stringify(compiledI18n) !== JSON.stringify(runtimeI18n)) {
    throw new TypeError(`Runtime i18n config does not match compiled i18n config for collection ${JSON.stringify(name)}`);
  }
  const i18n = compiledI18n as InferCollectionI18n<Collection, RuntimeI18n>;
  const compiledSlugs = new Map(compiledEntries.map((entry) => [entry.path, entry.slug]));
  const loaderSlugs: LumeLoaderOptions<Data & InferPluginData<Plugins>>['slugs'] = options.slugs
    ? (file) => options.slugs?.(file) ?? compiledSlugs.get(file.path)
    : undefined;

  type SourceConfig = {
    pageData: LumePageData<Data & InferPluginData<Plugins>>;
    metaData: MetaData;
  };

  const resolve = composeOnion(
    hooks.flatMap((hook) => hook.resolve ? [hook.resolve] : []),
    (entry: ResolvedEntry) => {
      if (entry.compiled.draft) entry.hide('draft');
    },
  );
  const list = composeOnion(
    hooks.flatMap((hook) => hook.list ? [hook.list] : []),
    (entries: readonly ResolvedEntry[], context: RuntimeContext) => {
      const revealed = new Set(context.preview?.reveal ?? []);
      if (context.preview?.draft) revealed.add('draft');
      if (context.preview?.future) revealed.add('future');
      return entries
        .filter((entry) => entry.hidden().every((reason) => revealed.has(reason)))
        .slice()
        .sort((a, b) => (
          (a.compiled.locale ?? '').localeCompare(b.compiled.locale ?? '')
          || a.compiled.slug.join('/').localeCompare(b.compiled.slug.join('/'))
        ));
    },
  );
  const deadline = composeOnion(
    hooks.flatMap((hook) => hook.deadline ? [hook.deadline] : []),
    () => Infinity,
  );

  function resolveAt(context: RuntimeContext) {
    const entries = compiledPages.map((page) => resolvedEntry(page.compiled, page.body));
    for (const entry of entries) resolve(entry, context);
    const listed = list(entries, context);
    if (!Array.isArray(listed)) throw new TypeError('lume-cms list middleware must return an entry array');
    return { entries, listed: listed as ResolvedState[] };
  }

  function filesAt(listed: readonly ResolvedState[]): ReturnType<DynamicSource<SourceConfig>['files']> {
    return [
      ...compiled.metas.map((meta) => ({
        type: 'meta' as const,
        path: meta.path,
        data: meta.data,
      })),
      ...listed
        .map((entry) => {
          const compiledEntry = entry.compiled;
          const data = {
            ...compiledEntry.data,
            title: typeof compiledEntry.data.title === 'string'
              ? compiledEntry.data.title
              : compiledEntry.slug.join('/') || 'index',
            body: entry.body,
            content: compiledEntry.body.markdown,
            processedMarkdown: compiledEntry.body.processedMarkdown,
            toc: compiledEntry.body.toc,
            structuredData: compiledEntry.body.structuredData,
            ...entry.dataPatch,
          } as LumePageData<Data & InferPluginData<Plugins>>;
          return {
            type: 'page' as const,
            path: compiledEntry.path,
            ...(loaderSlugs ? {} : { slugs: compiledEntry.slug }),
            data,
          };
        }),
    ];
  }

  function deadlineAt(entries: readonly ResolvedEntry[], context: RuntimeContext) {
    const value = deadline(entries, context);
    if (typeof value !== 'number' || Number.isNaN(value)) {
      throw new TypeError('lume-cms deadline middleware must return a number');
    }
    return value;
  }

  function createLoader(entries: readonly ResolvedState[]) {
    const source: DynamicSource<SourceConfig> = { files: () => filesAt(entries) };
    return dynamicLoader(source, {
      baseUrl,
      i18n,
      url: options.url,
      slugs: loaderSlugs,
      pageTree: options.pageTree as never,
      icon: options.icon,
      plugins: options.loaderPlugins as never,
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
    const context = { nowMs: at };
    const resolved = resolveAt(context);
    const loader = createLoader(resolved.listed);
    return {
      from: at,
      until: deadlineAt(resolved.entries, context),
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
      ...(previewOptions.reveal && { reveal: previewOptions.reveal }),
    };
    return createLoader(resolveAt({ nowMs: currentTime(), preview }).listed).get();
  }

  return { getSource, getPreviewSource } as unknown as FumadocsCollectionFactory<Collection, Plugins, RuntimeI18n>;
}

type ConfigCollections<Config extends LumeConfig> = Config extends {
  collections: infer Collections extends Record<string, CollectionConfig>;
} ? Collections : { default: CollectionConfig<[]> };

export function createFumadocsSources<
  Data extends Record<string, unknown>,
  const Config extends LumeConfig,
>(content: CompiledContent<Data>, config: Config) {
  assertCompiledContent(content);
  const collections = (config.collections ?? { default: {} }) as ConfigCollections<Config>;
  const collectionRecord = collections as Record<string, CollectionConfig>;
  const compiledNames = Object.keys(content.collections).sort();
  const runtimeNames = Object.keys(collections).sort();
  if (compiledNames.join('\0') !== runtimeNames.join('\0')) {
    const missing = compiledNames.filter((name) => !runtimeNames.includes(name));
    const extra = runtimeNames.filter((name) => !compiledNames.includes(name));
    throw new TypeError(`Compiled and runtime collections must match exactly (missing: ${missing.join(', ') || 'none'}; extra: ${extra.join(', ') || 'none'})`);
  }

  const baseUrls = new Map<string, string>();
  for (const name of runtimeNames) {
    const compiledBaseUrl = content.collections[name]!.baseUrl;
    const baseUrl = normalizeBaseUrl(compiledBaseUrl);
    const existing = baseUrls.get(baseUrl);
    if (existing) throw new TypeError(`Collections ${JSON.stringify(existing)} and ${JSON.stringify(name)} use the same baseUrl ${JSON.stringify(baseUrl)}`);
    baseUrls.set(baseUrl, name);
  }

  const sources = Object.fromEntries(runtimeNames.map((name) => [
    name,
    createCollectionSource(name, content.collections[name]!, collectionRecord[name]!, Date.now),
  ])) as unknown as {
    [Name in keyof ConfigCollections<Config>]: FumadocsCollectionFactory<
      CompiledCollection<Data>,
      PluginsOf<ConfigCollections<Config>[Name]>,
      RuntimeI18nOf<ConfigCollections<Config>[Name]>
    >;
  };

  async function getAllSources() {
    const sourceRecord = sources as Record<string, FumadocsCollectionFactory<CompiledCollection, readonly AnyLumePlugin[]>>;
    const pairs = await Promise.all(runtimeNames.map(async (name) => [name, await sourceRecord[name]!.getSource()] as const));
    return Object.fromEntries(pairs) as {
      [Name in keyof ConfigCollections<Config>]: Awaited<ReturnType<(typeof sources)[Name]['getSource']>>;
    };
  }

  async function getAllPages() {
    const loaded = await getAllSources();
    return Object.values(loaded).flatMap((source) => source.getPages());
  }

  return { sources, getAllSources, getAllPages };
}

export function createFumadocsSource<
  const Content extends CompiledContent,
>(content: Content): FumadocsCollectionFactory<
  InferSingleCollection<Content>,
  [],
  I18nConfig | undefined
>;
export function createFumadocsSource<
  const Content extends CompiledContent,
  const Config extends LumeConfig,
>(
  content: Content,
  config: Config,
): FumadocsCollectionFactory<
  InferSingleCollection<Content>,
  PluginsOf<ConfigCollections<Config>[keyof ConfigCollections<Config>]>,
  RuntimeI18nOf<ConfigCollections<Config>[keyof ConfigCollections<Config>]>
>;
/** First-class source factory for a compiled artifact containing one collection. */
export function createFumadocsSource(
  content: CompiledContent,
  config: LumeConfig = { collections: { default: {} } },
): FumadocsCollectionFactory<CompiledCollection, readonly AnyLumePlugin[], I18nConfig | undefined> {
  assertCompiledContent(content);
  const names = Object.keys(content.collections);
  if (names.length !== 1) {
    throw new TypeError(`createFumadocsSource() requires exactly one compiled collection; found ${names.length}. Use createFumadocsSources().`);
  }
  const name = names[0]!;
  const compiled = content.collections[name]!;
  const collections = config.collections ?? { [name]: {} };
  const configuredNames = Object.keys(collections);
  if (configuredNames.length !== 1 || !collections[name]) {
    throw new TypeError(`createFumadocsSource() config must define exactly the compiled collection ${JSON.stringify(name)}`);
  }
  return createCollectionSource(name, compiled, collections[name]!, Date.now);
}
