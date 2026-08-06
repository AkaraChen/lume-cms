import path from 'node:path';
import { watch, type FSWatcher } from 'chokidar';
import {
  CompileCache,
  compileContent,
  resolveCollections,
  type CompileStats,
  type ResolvedCollection,
} from './compile.js';
import { loadLumeConfig } from './config.js';
import type { CompiledContent } from './types.js';

export interface WatchBuildResult {
  content: CompiledContent;
  stats: CompileStats;
}

export interface WatchContentOptions {
  cwd?: string;
  debounceMs?: number;
  strict?: boolean;
  onBuild?(result: WatchBuildResult): void | Promise<void>;
  onError?(error: unknown): void | Promise<void>;
}

export interface ContentWatcher {
  rebuild(): Promise<WatchBuildResult | undefined>;
  close(): Promise<void>;
}

const ignoredDirectories = new Set(['.git', '.next', '.cache', 'dist', 'node_modules']);

export async function watchContent(options: WatchContentOptions = {}): Promise<ContentWatcher> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const cache = new CompileCache();
  const outputPaths = new Set<string>();
  const watcher: FSWatcher = watch(cwd, {
    ignoreInitial: true,
    atomic: true,
    awaitWriteFinish: { stabilityThreshold: 25, pollInterval: 10 },
    ignored(watchedPath) {
      const absolutePath = path.resolve(watchedPath);
      if (outputPaths.has(absolutePath)) return true;
      const relative = path.relative(cwd, absolutePath);
      return relative.split(path.sep).some((segment) => ignoredDirectories.has(segment));
    },
  });
  const ready = new Promise<void>((resolve) => { watcher.once('ready', () => resolve()); });
  const debounceMs = options.debounceMs ?? 50;
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let buildChain = Promise.resolve<WatchBuildResult | undefined>(undefined);
  let watchedRoots = new Set<string>();

  function externalRoots(collections: readonly ResolvedCollection[]) {
    return new Set(collections.map((collection) => collection.root).filter((root) => {
      const relative = path.relative(cwd, root);
      return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
    }));
  }

  async function updateWatchTargets(collections: readonly ResolvedCollection[], output: string) {
    const nextRoots = externalRoots(collections);
    await Promise.all([...watchedRoots]
      .filter((root) => !nextRoots.has(root))
      .map((root) => watcher.unwatch(root)));
    for (const root of nextRoots) {
      if (!watchedRoots.has(root)) watcher.add(root);
    }
    watchedRoots = nextRoots;
    outputPaths.clear();
    outputPaths.add(output);
  }

  async function build(): Promise<WatchBuildResult | undefined> {
    if (closed) return;
    try {
      const config = await loadLumeConfig(cwd);
      const collections = resolveCollections(cwd, config);
      await updateWatchTargets(collections, path.resolve(cwd, config.output ?? 'content.generated.json'));
      const content = await compileContent({
        cwd,
        config,
        resolvedCollections: collections,
        cache,
        strict: options.strict,
      });
      const result = { content, stats: { ...cache.stats } };
      await options.onBuild?.(result);
      return result;
    } catch (error) {
      await options.onError?.(error);
    }
  }

  function enqueueBuild(): Promise<WatchBuildResult | undefined> {
    buildChain = buildChain.then(build, build);
    return buildChain;
  }

  function scheduleBuild() {
    if (closed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void enqueueBuild();
    }, debounceMs);
  }

  function isCurrentWatchTarget(watchedPath: string) {
    const absolutePath = path.resolve(watchedPath);
    const relative = path.relative(cwd, absolutePath);
    if (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) return true;
    return [...watchedRoots].some((root) => (
      absolutePath === root || absolutePath.startsWith(`${root}${path.sep}`)
    ));
  }

  watcher.on('all', (_event, watchedPath) => {
    if (isCurrentWatchTarget(watchedPath)) scheduleBuild();
  });
  watcher.on('error', (error) => { void options.onError?.(error); });
  await Promise.all([ready, enqueueBuild()]);

  return {
    rebuild: enqueueBuild,
    async close() {
      if (closed) return;
      closed = true;
      if (timer) clearTimeout(timer);
      await watcher.close();
      await buildChain;
    },
  };
}
