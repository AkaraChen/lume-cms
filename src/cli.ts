#!/usr/bin/env node
import { compileContent } from './compile.js';
import { watchContent } from './watch.js';

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] ?? 'build';
  const watch = args[1] === '--watch';
  if (command !== 'build' || args.length > (watch ? 2 : 1)) {
    throw new Error('Usage: lume-cms build [--watch]');
  }
  if (watch) {
    const watcher = await watchContent({
      onBuild({ content, stats }) {
        const entryCount = Object.values(content.collections)
          .reduce((total, collection) => total + collection.entries.length, 0);
        console.log(
          `Compiled ${entryCount} content entries (${stats.compiledEntries} rebuilt, ${stats.cachedEntries} cached).`,
        );
      },
      onError(error) {
        console.error(error instanceof Error ? error.message : error);
      },
    });
    console.log('Watching for content and configuration changes.');
    const close = () => { void watcher.close(); };
    process.once('SIGINT', close);
    process.once('SIGTERM', close);
    return;
  }
  const content = await compileContent();
  const counts = Object.entries(content.collections).map(([name, collection]) => `${name}: ${collection.entries.length}`);
  console.log(`Compiled ${counts.join(', ')}.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
