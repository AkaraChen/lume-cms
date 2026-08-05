import { loadConfig } from 'c12';
import { metaSchema as fumadocsMetaSchema, pageSchema as fumadocsPageSchema } from 'fumadocs-core/source/schema';
import { z } from 'zod';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { I18nConfig } from 'fumadocs-core/i18n';
import type { AnyLumePlugin } from './plugin.js';

export { defineI18n } from 'fumadocs-core/i18n';
export type { I18nConfig } from 'fumadocs-core/i18n';
export { composeOnion, definePlugin } from './plugin.js';
export type {
  AnyLumePlugin,
  CompileCollectionContext,
  CompileEntryContext,
  LumePlugin,
  Middleware,
  Next,
  PreviewContext,
  PreviewOptions,
  RuntimeContext,
  ResolvedEntry,
} from './plugin.js';

/** The exact Fumadocs baseline, exported so Zod users can extend it directly. */
export const officialPageSchema = fumadocsPageSchema;
export const officialMetaSchema = fumadocsMetaSchema;
export const defaultPageSchema = officialPageSchema.extend({
  /** lume-cms public page-data extension, used by search integrations. */
  tags: z.array(z.string()).optional(),
});
export const defaultMetaSchema = officialMetaSchema;
/** @deprecated Use defaultPageSchema. */
export const defaultFrontmatterSchema = defaultPageSchema;

export type ContentSchema = StandardSchemaV1<unknown, Record<string, unknown>>;

export interface CollectionConfig {
  /** Public route prefix shared by reference validation and the Fumadocs loader. */
  baseUrl?: string;
  /** The official Fumadocs i18n contract used by this collection at compile and runtime. */
  i18n?: I18nConfig;
  include?: string[];
  exclude?: string[];
  root?: string;
  /** Any Standard Schema implementation, including Valibot 1 and Zod 4. */
  schema?: ContentSchema;
  /** Defaults to Fumadocs metaSchema; replace or extend it with any Standard Schema. */
  metaSchema?: ContentSchema;
  /** Overrides the top-level plugin defaults for this collection. */
  plugins?: readonly AnyLumePlugin[];
}

export interface LumeConfig {
  /** @deprecated Use `collections` instead. */
  content?: CollectionConfig;
  collections?: Record<string, CollectionConfig>;
  output?: string;
  /** Default plugins for collections that do not declare their own list. */
  plugins?: readonly AnyLumePlugin[];
}

export function defineConfig<const T extends LumeConfig>(config: T): T {
  return config;
}

export async function loadLumeConfig(cwd = process.cwd()): Promise<LumeConfig> {
  const loaded = await loadConfig<LumeConfig>({
    name: 'lume',
    cwd,
    configFile: 'lume.config',
    defaults: {},
    jitiOptions: { moduleCache: false },
  });
  return loaded.config;
}
