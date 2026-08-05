import { loadConfig } from 'c12';
import * as v from 'valibot';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { AnyLumePlugin } from './plugin.js';

export { definePlugin } from './plugin.js';
export type { AnyLumePlugin, LumePlugin } from './plugin.js';

export const defaultFrontmatterSchema = v.looseObject({
  title: v.string(),
  description: v.optional(v.string()),
  icon: v.optional(v.string()),
  full: v.optional(v.boolean()),
  slug: v.optional(v.string()),
  draft: v.optional(v.boolean(), false),
  tags: v.optional(v.array(v.string())),
});

export type ContentSchema = StandardSchemaV1<unknown, Record<string, unknown>>;

export interface CollectionConfig {
  /** Public route prefix shared by reference validation and the Fumadocs loader. */
  baseUrl?: string;
  include?: string[];
  exclude?: string[];
  root?: string;
  /** Any Standard Schema implementation, including Valibot 1 and Zod 4. */
  schema?: ContentSchema;
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
