import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { CollectionConfig, LumeConfig } from './config.js';
import type { CompiledEntry } from './types.js';

export interface BuildPluginContext {
  cwd: string;
  config: LumeConfig;
}

export interface BuildEntryContext {
  sourcePath: string;
  contentPath: string;
  slug: string[];
  /** The plugin schema's validated output. */
  frontmatter: Record<string, unknown>;
  /** Unvalidated source frontmatter, for exceptional cases that need it. */
  rawFrontmatter: Record<string, unknown>;
}

export interface BuildCollectionContext extends BuildPluginContext {
  entries: CompiledEntry[];
}

export interface PreviewOptions {
  draft?: boolean;
  future?: boolean;
  /** Reveal entries hidden for custom plugin reasons. */
  reveal?: readonly string[];
}

export interface PreviewContext {
  draft: boolean;
  future: boolean;
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

export interface RuntimeHooks {
  /** Mark or decorate one generation-scoped entry. */
  resolve?(entry: ResolvedEntry, context: RuntimeContext, next: Next<void>): void;
  /** Filter or reorder the shared entry list. */
  list?(
    entries: readonly ResolvedEntry[],
    context: RuntimeContext,
    next: Next<ResolvedEntry[]>,
  ): ResolvedEntry[];
  /** Return the first instant after `nowMs` at which this generation is stale. */
  deadline?(
    entries: readonly ResolvedEntry[],
    context: RuntimeContext,
    next: Next<number>,
  ): number;
  /** Requires `deadline` so request-time visibility cannot become permanently stale. */
  timeDependent?: boolean;
}

export interface TimeGateOptions {
  reason: string;
  /** Transition instant for an entry, or null when the gate does not apply. */
  at(entry: ResolvedEntry): number | null;
  /** Skip cache invalidation for entries that cannot become publicly visible. */
  invalidate?(entry: ResolvedEntry): boolean;
  /** Hide at and after the transition instead of before it. */
  after?: boolean;
}

/** Derive runtime visibility and invalidation from one time-bound declaration. */
export function defineTimeGate(options: TimeGateOptions): RuntimeHooks {
  return {
    timeDependent: true,
    resolve(entry, { nowMs }, next) {
      next();
      const at = options.at(entry);
      if (at !== null && (options.after ? nowMs >= at : nowMs < at)) entry.hide(options.reason);
    },
    deadline(entries, { nowMs }, next) {
      return entries
        .filter((entry) => options.invalidate?.(entry) !== false)
        .map(options.at)
        .filter((at): at is number => at !== null && at > nowMs)
        .reduce((earliest, at) => Math.min(earliest, at), next());
    },
  };
}

const buildPluginBrand: unique symbol = Symbol.for('lume-cms.build-plugin') as never;
const runtimePluginBrand: unique symbol = Symbol.for('lume-cms.runtime-plugin') as never;

interface PluginInference<Frontmatter extends object, Data extends object> {
  /** Type-only carrier; plugin implementations must not set this at runtime. */
  readonly $Infer?: { frontmatter: Frontmatter; data: Data };
}

export interface LumeBuildPlugin<Frontmatter extends object = object, Data extends object = object>
  extends PluginInference<Frontmatter, Data> {
  readonly [buildPluginBrand]: true;
  id: string;
  frontmatter?: {
    schema: StandardSchemaV1<unknown, Record<string, unknown>>;
  };
  build?: {
    /** Stable options/version key for invalidating incremental compilation. */
    cacheKey?: string;
    setup?(context: BuildPluginContext, next: Next<Promise<void>>): void | Promise<void>;
    entry?(context: BuildEntryContext): unknown | Promise<unknown>;
    collection?(context: BuildCollectionContext, next: Next<Promise<void>>): void | Promise<void>;
  };
}

export interface LumeRuntimePlugin<Frontmatter extends object = object, Data extends object = object>
  extends PluginInference<Frontmatter, Data> {
  readonly [runtimePluginBrand]: true;
  id: string;
  runtime: RuntimeHooks;
}

export type LumePlugin<Frontmatter extends object = object, Data extends object = object> =
  LumeBuildPlugin<Frontmatter, Data> & LumeRuntimePlugin<Frontmatter, Data>;

export type AnyBuildPlugin = LumeBuildPlugin<any, any>;
export type AnyRuntimePlugin = LumeRuntimePlugin<any, any>;
export type AnyLumePlugin = AnyBuildPlugin | AnyRuntimePlugin;

/** Preserve each collection's plugin tuple for runtime page-data inference. */
export function collection<const Plugins extends readonly AnyLumePlugin[] = []>(
  config: CollectionConfig<Plugins>,
): CollectionConfig<Plugins> {
  return config;
}

type UnionToIntersection<Union> =
  (Union extends unknown ? (value: Union) => void : never) extends (value: infer Intersection) => void
    ? Intersection
    : never;

export type InferPluginData<Plugins extends readonly AnyLumePlugin[]> =
  [Plugins[number]] extends [never]
    ? Record<never, never>
    : UnionToIntersection<NonNullable<Plugins[number]['$Infer']>['data']>;

export interface BuildPluginDefinition<Frontmatter extends object = object, Data extends object = object>
  extends PluginInference<Frontmatter, Data> {
  id: string;
  frontmatter?: LumeBuildPlugin<Frontmatter, Data>['frontmatter'];
  build?: LumeBuildPlugin<Frontmatter, Data>['build'];
}

export interface RuntimePluginDefinition<Frontmatter extends object = object, Data extends object = object>
  extends PluginInference<Frontmatter, Data> {
  id: string;
  runtime: RuntimeHooks;
}

export function defineBuildPlugin<const Plugin extends BuildPluginDefinition>(plugin: Plugin): Plugin & AnyBuildPlugin {
  return Object.assign(plugin, { [buildPluginBrand]: true as const });
}

export function defineRuntimePlugin<const Plugin extends RuntimePluginDefinition>(plugin: Plugin): Plugin & AnyRuntimePlugin {
  return Object.assign(plugin, { [runtimePluginBrand]: true as const });
}

export function definePlugin<Frontmatter extends object = object, Data extends object = object>(
  plugin: BuildPluginDefinition<Frontmatter, Data> & RuntimePluginDefinition<Frontmatter, Data>,
): LumePlugin<Frontmatter, Data> {
  return Object.assign(plugin, {
    [buildPluginBrand]: true as const,
    [runtimePluginBrand]: true as const,
  });
}

export function isBuildPlugin(plugin: AnyLumePlugin): plugin is AnyBuildPlugin {
  return buildPluginBrand in plugin;
}

export function isRuntimePlugin(plugin: AnyLumePlugin): plugin is AnyRuntimePlugin {
  return runtimePluginBrand in plugin;
}

export function assertPluginIds(plugins: readonly AnyLumePlugin[]): void {
  const seen = new Set<string>();
  for (const plugin of plugins) {
    if (!plugin.id) throw new TypeError('lume-cms plugin id must not be empty');
    if (seen.has(plugin.id)) throw new TypeError(`Duplicate lume-cms plugin id: ${plugin.id}`);
    seen.add(plugin.id);
  }
}
