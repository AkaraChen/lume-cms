import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { I18nConfig } from 'fumadocs-core/i18n';
import * as v from 'valibot';
import type {
  ContentStorage,
  ContentStorageMetaFile,
  ContentStoragePageFile,
  LoaderOptions,
  MetaData,
  PageData,
} from 'fumadocs-core/source';
import type { AnyLumePlugin, InferPluginData } from './plugin.js';

export { defineI18n } from 'fumadocs-core/i18n';
export type { I18nConfig } from 'fumadocs-core/i18n';
export {
  collection,
  defineBuildPlugin,
  definePlugin,
  defineRuntimePlugin,
  defineTimeGate,
} from './plugin.js';
export type {
  AnyBuildPlugin,
  AnyLumePlugin,
  AnyRuntimePlugin,
  BuildCollectionContext,
  BuildEntryContext,
  BuildPluginContext,
  LumeBuildPlugin,
  LumePlugin,
  LumeRuntimePlugin,
  Middleware,
  Next,
  PreviewContext,
  PreviewOptions,
  ResolvedEntry,
  RuntimeContext,
  RuntimeHooks,
  TimeGateOptions,
} from './plugin.js';

export type ContentSchema = StandardSchemaV1<unknown, Record<string, unknown>>;

export const defaultPageSchema = v.object({
  title: v.string(),
  description: v.optional(v.string()),
  icon: v.optional(v.string()),
  full: v.optional(v.boolean()),
  _openapi: v.optional(v.record(v.string(), v.unknown())),
  /** lume-cms public page-data extension, used by search integrations. */
  tags: v.optional(v.array(v.string())),
});

export const defaultMetaSchema = v.object({
  title: v.optional(v.string()),
  pages: v.optional(v.array(v.string())),
  pagesIndex: v.optional(v.string()),
  description: v.optional(v.string()),
  root: v.optional(v.boolean()),
  defaultOpen: v.optional(v.boolean()),
  collapsible: v.optional(v.boolean()),
  icon: v.optional(v.string()),
});

type CollectionStorage<Plugins extends readonly AnyLumePlugin[]> = ContentStorage<
  ContentStoragePageFile<undefined, PageData & InferPluginData<Plugins>>,
  ContentStorageMetaFile<undefined, MetaData>
>;

type CollectionLoaderOptions<Plugins extends readonly AnyLumePlugin[]> = LoaderOptions<
  CollectionStorage<Plugins>,
  I18nConfig | undefined
>;

export interface CollectionConfig<
  Plugins extends readonly AnyLumePlugin[] = readonly AnyLumePlugin[],
> {
  /** Public route prefix shared by reference validation and the Fumadocs loader. */
  baseUrl?: string;
  /** The official Fumadocs i18n contract used at build and runtime. */
  i18n?: I18nConfig;
  /** Page globs relative to `root`. */
  include?: string[];
  /** Ignored globs relative to `root`. */
  exclude?: string[];
  root?: string;
  /** Any Standard Schema implementation, including Valibot 1 and Zod 4. */
  schema?: ContentSchema;
  /** Defaults to the Valibot Fumadocs-compatible meta schema. */
  metaSchema?: ContentSchema;
  /** Build/runtime capabilities owned by this collection. */
  plugins?: Plugins;
  /** Fumadocs runtime options consumed only by the source factory. */
  url?: CollectionLoaderOptions<Plugins>['url'];
  slugs?: CollectionLoaderOptions<Plugins>['slugs'];
  pageTree?: Omit<NonNullable<CollectionLoaderOptions<Plugins>['pageTree']>, 'url'>;
  icon?: CollectionLoaderOptions<Plugins>['icon'];
  loaderPlugins?: CollectionLoaderOptions<Plugins>['plugins'];
}

export interface LumeConfig<
  Collections extends Record<string, CollectionConfig> = Record<string, CollectionConfig>,
> {
  collections?: Collections;
  output?: string;
}

export function defineConfig<const Config extends LumeConfig>(config: Config): Config {
  return config;
}
