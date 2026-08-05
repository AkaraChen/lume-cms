import { loadConfig } from 'c12';
import * as v from 'valibot';
import type { StandardSchemaV1 } from '@standard-schema/spec';

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

export type ContentSchema = StandardSchemaV1<unknown, Record<string, unknown>>;

export interface LumeConfig {
  content?: {
    include?: string[];
    exclude?: string[];
    root?: string;
    /** Any Standard Schema implementation, including Valibot 1 and Zod 4. */
    schema?: ContentSchema;
  };
  output?: string;
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
