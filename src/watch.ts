import path from 'node:path';
import { watch, type FSWatcher } from 'chokidar';
import {
  CompileCache,
  compileContent,
  resolveCollections,
  type CompileStats,
  type ResolvedCollection,
} from './compile.js';
import { loadLumeConfig } from './load-config.js';
import type { CompiledContent } from './types.js';

export interface WatchBuildResult {
  content: CompiledContent;
  stats: CompileStats;
}

export interface WatchContentOptions {
  cwd?: string;
  debounceMs?: number;
  strict?: boolean;
  onBuild?: (result: WatchBuildResult) => void | Promise<void>;
  onError?: (error: unknown) => void | Promise<void>;
}

export interface ContentWatcher {
  rebuild: () => Promise<WatchBuildResult | undefined>;
  close: () => Promise<void>;
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
  const ready = new Promise<void>((resolve) => { watcher.once('ready', () => { resolve(); }); });
  const debounceMs = options.debounceMs ?? 50;
  let isClosed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let buildChain = Promise.resolve<WatchBuildResult | undefined>(undefined);
  let activeRoots = new Set<string>();
  let watchedCoverage = new Set<string>();
  const inactiveCoverage = new Set<string>();

  function externalRoots(collections: readonly ResolvedCollection[]) {
    return new Set(collections.map((collection) => collection.root).filter((root) => {
      const relative = path.relative(cwd, root);
      return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
    }));
  }

  function containsPath(parent: string, child: string) {
    const relative = path.relative(parent, child);
    return relative === '' || (relative !== '..'
      && !relative.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relative));
  }

  function recursiveCoverage(roots: ReadonlySet<string>) {
    return new Set([...roots].filter((root) => [...roots].every((candidate) => (
      candidate === root || !containsPath(candidate, root)
    ))));
  }

  function updateWatchTargets(collections: readonly ResolvedCollection[], output: string) {
    const nextActiveRoots = externalRoots(collections);
    const nextCoverage = new Set([...watchedCoverage].filter((watchedRoot) => (
      [...nextActiveRoots].some((activeRoot) => (
        containsPath(watchedRoot, activeRoot) || containsPath(activeRoot, watchedRoot)
      ))
    )));
    activeRoots = nextActiveRoots;
    const removedCoverage = [...watchedCoverage].filter((root) => !nextCoverage.has(root));
    for (const root of removedCoverage) {
      watcher.unwatch(root);
      inactiveCoverage.add(root);
    }
    for (const root of inactiveCoverage) {
      if ([...nextActiveRoots].every((activeRoot) => (
        !(containsPath(root, activeRoot) || containsPath(activeRoot, root))
      ))) continue;
      watcher.add(root);
      nextCoverage.add(root);
      inactiveCoverage.delete(root);
    }
    for (const root of recursiveCoverage(nextActiveRoots)) {
      if ([...nextCoverage].some((watchedRoot) => containsPath(watchedRoot, root))) continue;
      watcher.add(root);
      nextCoverage.add(root);
    }
    watchedCoverage = nextCoverage;
    outputPaths.clear();
    outputPaths.add(output);
  }

  async function build(): Promise<WatchBuildResult | undefined> {
    if (isClosed) return undefined;
    try {
      const config = await loadLumeConfig(cwd);
      const collections = resolveCollections(cwd, config);
      updateWatchTargets(collections, path.resolve(cwd, config.output ?? 'content.generated.json'));
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
      return undefined;
    }
  }

  async function enqueueBuild(): Promise<WatchBuildResult | undefined> {
    const previous = buildChain;
    // `build` never rejects (it reports through onError), so awaiting the
    // previous run only serializes builds.
    buildChain = (async () => {
      await previous;
      return build();
    })();
    return buildChain;
  }

  function scheduleBuild() {
    if (isClosed) return;
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
    return [...activeRoots].some((root) => (
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
      if (isClosed) return;
      isClosed = true;
      if (timer) clearTimeout(timer);
      await watcher.close();
      await buildChain;
    },
  };
}
