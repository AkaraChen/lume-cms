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
  /** The plugin schema's validated output. */
  frontmatter: Record<string, unknown>;
  /** Unvalidated source frontmatter, for exceptional cases that need it. */
  rawFrontmatter: Record<string, unknown>;
}

export interface CompileCollectionContext extends PluginContext {
  entries: CompiledEntry[];
}

export interface PreviewOptions {
  draft?: boolean;
  future?: boolean;
  /** Reserved for plugins that implement expiration visibility. */
  expired?: boolean;
  /** Reveal entries hidden for custom plugin reasons. */
  reveal?: readonly string[];
}

export interface PreviewContext {
  draft: boolean;
  future: boolean;
  expired: boolean;
  reveal?: readonly string[];
}

export interface RuntimeContext {
  nowMs: number;
  /** Present only for an isolated per-request preview read. */
  preview?: PreviewContext;
}

export type Next<Result> = () => Result;

export interface ResolvedEntry<Data extends Record<string, unknown> = Record<string, unknown>> {
  /** Immutable compiled input. Runtime state belongs on this generation-scoped wrapper. */
  readonly compiled: Readonly<CompiledEntry<Data>>;
  /** Hide this entry from the shared list boundary for the given reason. */
  hide(reason: string): void;
  /** All visibility reasons currently attached to this entry. */
  hidden(): readonly string[];
  /** Set plugin-private generation state; this never changes visibility. */
  set(key: string, value: unknown): void;
  /** Read plugin-private generation state. */
  get<Value = unknown>(key: string): Value | undefined;
  /** Merge fields into the final Fumadocs page data. */
  patchData(patch: Record<string, unknown>): void;
}

export type Middleware<Arguments extends unknown[], Result> = (
  ...arguments_: [...Arguments, Next<Result>]
) => Result;

/**
 * Compose middleware outside-in around a core operation. A middleware may
 * short-circuit, but calling `next()` more than once is always an error.
 */
export function composeOnion<Arguments extends unknown[], Result>(
  middleware: readonly Middleware<Arguments, Result>[],
  core: (...arguments_: Arguments) => Result,
): (...arguments_: Arguments) => Result {
  return (...arguments_) => {
    const dispatch = (index: number): Result => {
      if (index === middleware.length) return core(...arguments_);
      let called = false;
      return middleware[index]!(...arguments_, () => {
        if (called) throw new TypeError('lume-cms plugin middleware called next() more than once');
        called = true;
        return dispatch(index + 1);
      });
    };
    return dispatch(0);
  };
}

export interface LumePlugin<Frontmatter extends object = object, Data extends object = object> {
  id: string;
  frontmatter?: {
    schema: StandardSchemaV1<unknown, Record<string, unknown>>;
  };
  compile?: {
    /** Stable options/version key for invalidating incremental compilation. */
    cacheKey?: string;
    setup?(context: PluginContext, next: Next<Promise<void>>): void | Promise<void>;
    entry?(context: CompileEntryContext): unknown | Promise<unknown>;
    collection?(context: CompileCollectionContext, next: Next<Promise<void>>): void | Promise<void>;
    /** @deprecated Use `collection`. */
    finalize?(entries: CompiledEntry[], context: PluginContext): void | Promise<void>;
  };
  runtime?: {
    resolve?(entry: ResolvedEntry, context: RuntimeContext, next: Next<void>): void;
    list?(
      entries: readonly ResolvedEntry[],
      context: RuntimeContext,
      next: Next<ResolvedEntry[]>,
    ): ResolvedEntry[];
    timeDependent?: boolean;
    /** @deprecated Use `resolve` and `entry.hide()`. */
    visible?(entry: CompiledEntry, context: RuntimeContext): boolean;
    /** The next runtime boundary. Time-dependent plugins must implement this hook. */
    deadline?(entries: readonly CompiledEntry[], context: RuntimeContext): number;
    /** @deprecated Use `list`. */
    compare?(a: CompiledEntry, b: CompiledEntry): number;
    /** @deprecated Use `resolve` and `entry.patchData()`. */
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
