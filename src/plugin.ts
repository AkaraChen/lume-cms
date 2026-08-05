import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { LumeConfig } from './config.js';
import type { CompiledEntry } from './types.js';

export interface PluginContext {
  cwd: string;
  config: LumeConfig;
}

export interface CompileEntryContext {
  sourcePath: string;
  contentPath: string;
  slug: string[];
  frontmatter: Record<string, unknown>;
}

export interface RuntimeContext {
  nowMs: number;
}

export interface LumePlugin<Frontmatter extends object = object, Data extends object = object> {
  id: string;
  frontmatter?: {
    schema: StandardSchemaV1<unknown, Record<string, unknown>>;
    keys: readonly string[];
  };
  compile?: {
    setup?(context: PluginContext): void | Promise<void>;
    entry?(context: CompileEntryContext): unknown | Promise<unknown>;
    finalize?(entries: CompiledEntry[], context: PluginContext): void | Promise<void>;
  };
  runtime?: {
    visible?(entry: CompiledEntry, context: RuntimeContext): boolean;
    deadline?(entries: readonly CompiledEntry[], context: RuntimeContext): number;
    compare?(a: CompiledEntry, b: CompiledEntry): number;
    pageData?(entry: CompiledEntry): Record<string, unknown>;
  };
  /** Type-only carrier; plugin implementations must not set this at runtime. */
  readonly $Infer?: { frontmatter: Frontmatter; data: Data };
}

export type AnyLumePlugin = LumePlugin<any, any>;

type UnionToIntersection<Union> =
  (Union extends unknown ? (value: Union) => void : never) extends (value: infer Intersection) => void
    ? Intersection
    : never;

export type InferPluginData<Plugins extends readonly AnyLumePlugin[]> =
  [Plugins[number]] extends [never]
    ? Record<never, never>
    : UnionToIntersection<NonNullable<Plugins[number]['$Infer']>['data']>;

export function definePlugin<const Plugin extends AnyLumePlugin>(plugin: Plugin): Plugin {
  return plugin;
}

export function assertPluginIds(plugins: readonly AnyLumePlugin[]): void {
  const seen = new Set<string>();
  for (const plugin of plugins) {
    if (!plugin.id) throw new TypeError('lume-cms plugin id must not be empty');
    if (seen.has(plugin.id)) throw new TypeError(`Duplicate lume-cms plugin id: ${plugin.id}`);
    seen.add(plugin.id);
  }
}
