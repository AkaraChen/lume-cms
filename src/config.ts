import { loadConfig } from 'c12';
import * as v from 'valibot';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { Pluggable } from 'unified';

export const defaultFrontmatterSchema = v.looseObject({
  title: v.string(),
  description: v.optional(v.string()),
  icon: v.optional(v.string()),
  full: v.optional(v.boolean()),
  slug: v.optional(v.string()),
  publishDate: v.optional(v.string()),
  draft: v.optional(v.boolean(), false),
  tags: v.optional(v.array(v.string())),
});

export const defaultMetaSchema = v.looseObject({
  title: v.optional(v.string()),
  pages: v.optional(v.array(v.string())),
  pagesIndex: v.optional(v.string()),
  description: v.optional(v.string()),
  root: v.optional(v.boolean()),
  defaultOpen: v.optional(v.boolean()),
  collapsible: v.optional(v.boolean()),
  icon: v.optional(v.string()),
});

export type ContentSchema = StandardSchemaV1<unknown, Record<string, unknown>>;
export type PluginOption = Pluggable[] | ((defaults: Pluggable[]) => Pluggable[]);

export interface LumeConfig {
  content?: {
    include?: string[];
    exclude?: string[];
    root?: string;
    /** Any Standard Schema implementation, including Valibot 1 and Zod 4. */
    schema?: ContentSchema;
    metaSchema?: ContentSchema;
  };
  /** Extra MDX plugins, or a function that composes/reorders the official defaults. */
  remarkPlugins?: PluginOption;
  /** Extra MDX plugins, or a function that composes/reorders the official defaults. */
  rehypePlugins?: PluginOption;
  output?: string;
  defaultTimezone?: string;
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
  });
  return loaded.config;
}
