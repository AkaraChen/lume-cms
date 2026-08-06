#!/usr/bin/env node
import type { CompileDiagnostic } from './types.js';

function reportDiagnostics(diagnostics: CompileDiagnostic[]) {
  for (const diagnostic of diagnostics) {
    console.warn(JSON.stringify({ type: 'lume-cms-diagnostic', ...diagnostic }));
  }
  if (diagnostics.length > 0) console.warn(`Found ${diagnostics.length} content reference warning${diagnostics.length === 1 ? '' : 's'}.`);
}

function reportError(error: unknown) {
  const diagnostics = (error as { diagnostics?: unknown } | null)?.diagnostics;
  if (Array.isArray(diagnostics)) reportDiagnostics(diagnostics as CompileDiagnostic[]);
  console.error(error instanceof Error ? error.message : error);
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] ?? 'build';
  const flags = args.slice(1);
  const uniqueFlags = new Set(flags);
  if (
    command !== 'build'
    || uniqueFlags.size !== flags.length
    || flags.some((flag) => flag !== '--watch' && flag !== '--strict')
  ) {
    throw new Error('Usage: lume-cms build [--watch] [--strict]');
  }
  const strict = uniqueFlags.has('--strict');
  if (uniqueFlags.has('--watch')) {
    const { watchContent } = await import('./watch.js');
    const watcher = await watchContent({
      strict,
      onBuild({ content, stats }) {
        const entryCount = Object.values(content.collections)
          .reduce((total, collection) => total + collection.entries.length, 0);
        reportDiagnostics(Object.values(content.collections).flatMap((collection) => collection.diagnostics ?? []));
        console.log(
          `Compiled ${entryCount} content entries (${stats.compiledEntries} rebuilt, ${stats.cachedEntries} cached).`,
        );
      },
      onError: reportError,
    });
    console.log('Watching for content changes.');
    const close = () => { void watcher.close(); };
    process.once('SIGINT', close);
    process.once('SIGTERM', close);
    return;
  }
  const { compileContent } = await import('./compile.js');
  const content = await compileContent({ strict });
  reportDiagnostics(Object.values(content.collections).flatMap((collection) => collection.diagnostics ?? []));
  const counts = Object.entries(content.collections).map(([name, collection]) => `${name}: ${collection.entries.length}`);
  console.log(`Compiled ${counts.join(', ')}.`);
}

main().catch((error: unknown) => {
  reportError(error);
  process.exitCode = 1;
});
