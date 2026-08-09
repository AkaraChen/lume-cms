import path from 'node:path';
import type { ContentWatcher, WatchBuildResult } from './watch.js';
import type { CompiledContent, CompileDiagnostic } from './types.js';

// Public values from next/constants. Keeping them local makes `lume-cms/next`
// testable without installing Next.js in the compiler package itself.
const PHASE_DEVELOPMENT_SERVER = 'phase-development-server';
const PHASE_PRODUCTION_BUILD = 'phase-production-build';

type NextConfig = object;

export interface NextConfigContext {
  defaultConfig: NextConfig;
  [key: string]: unknown;
}

export type NextConfigFunction = (
  phase: string,
  context: NextConfigContext,
) => NextConfig | Promise<NextConfig>;

export type NextConfigExport = NextConfig | NextConfigFunction;

export interface LumeNextOptions {
  /** Directory containing lume.config and the Next.js app. */
  cwd?: string;
  /** Fail production builds, and report development errors, for reference diagnostics. */
  strict?: boolean;
}

interface NextPluginRegistry {
  builds: Map<string, Promise<void>>;
  watchers: Map<string, Promise<ContentWatcher>>;
}

const registryKey = Symbol.for('lume-cms.next-plugin.registry');

function registry(): NextPluginRegistry {
  const scope = globalThis as typeof globalThis & { [registryKey]?: NextPluginRegistry };
  scope[registryKey] ??= { builds: new Map(), watchers: new Map() };
  return scope[registryKey];
}

function isConfigFunction(config: NextConfigExport): config is NextConfigFunction {
  return typeof config === 'function';
}

function diagnostics(content: CompiledContent): CompileDiagnostic[] {
  return Object.values(content.collections).flatMap((collection) => collection.diagnostics ?? []);
}

function reportDiagnostics(items: readonly CompileDiagnostic[]): void {
  for (const diagnostic of items) {
    process.stderr.write(`${JSON.stringify({ type: 'lume-cms-diagnostic', ...diagnostic })}\n`);
  }
  if (items.length > 0) {
    process.stderr.write(`Found ${items.length} content reference warning${items.length === 1 ? '' : 's'}.\n`);
  }
}

function entryCount(content: CompiledContent): number {
  return Object.values(content.collections)
    .reduce((total, collection) => total + collection.entries.length, 0);
}

function reportBuild({ content, stats }: WatchBuildResult): void {
  reportDiagnostics(diagnostics(content));
  process.stdout.write(
    `Compiled ${entryCount(content)} content entries (${stats.compiledEntries} rebuilt, ${stats.cachedEntries} cached).\n`,
  );
}

function reportError(error: unknown): void {
  const errorDiagnostics = (error as { diagnostics?: unknown } | null)?.diagnostics;
  if (Array.isArray(errorDiagnostics)) reportDiagnostics(errorDiagnostics as CompileDiagnostic[]);
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
}

async function buildContent(cwd: string, isStrict: boolean): Promise<void> {
  const key = `${cwd}\0${isStrict}`;
  const state = registry();
  let build = state.builds.get(key);
  if (!build) {
    build = (async () => {
      const { compileContent } = await import('./compile.js');
      const content = await compileContent({ cwd, strict: isStrict });
      reportDiagnostics(diagnostics(content));
      process.stdout.write(`Compiled ${entryCount(content)} content entries.\n`);
    })();
    state.builds.set(key, build);
  }
  await build;
}

async function watchContent(cwd: string, isStrict: boolean): Promise<void> {
  const key = `${cwd}\0${isStrict}`;
  const state = registry();
  let watcher = state.watchers.get(key);
  if (!watcher) {
    watcher = (async () => {
      const { watchContent: startWatching } = await import('./watch.js');
      return startWatching({
        cwd,
        strict: isStrict,
        onBuild: reportBuild,
        onError: reportError,
      });
    })();
    state.watchers.set(key, watcher);
  }
  await watcher;
}

/** Create a Next.js config enhancer for `next build` and `next dev`. */
export function createLume(options: LumeNextOptions = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const isStrict = options.strict ?? false;

  return function withLume(nextConfig: NextConfigExport = {}): NextConfigExport {
    return async (phase, context) => {
      if (phase === PHASE_DEVELOPMENT_SERVER) await watchContent(cwd, isStrict);
      if (phase === PHASE_PRODUCTION_BUILD) await buildContent(cwd, isStrict);
      if (isConfigFunction(nextConfig)) return nextConfig(phase, context);
      return nextConfig;
    };
  };
}
