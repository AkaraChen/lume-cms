import { loadConfig } from 'c12';
import * as v from 'valibot';
import type { GenericSchema } from 'valibot';

export const defaultFrontmatterSchema = v.looseObject({
  title: v.string(),
  description: v.optional(v.string()),
  slug: v.optional(v.string()),
  publishDate: v.optional(v.string()),
  draft: v.optional(v.boolean(), false),
  tags: v.optional(v.array(v.string())),
});

export interface LumeConfig {
  content?: {
    include?: string[];
    exclude?: string[];
    root?: string;
    schema?: GenericSchema<unknown, Record<string, unknown>>;
  };
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
