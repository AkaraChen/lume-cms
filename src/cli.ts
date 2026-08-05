#!/usr/bin/env node
import { compileContent } from './compile.js';

async function main() {
  const command = process.argv[2] ?? 'build';
  if (command !== 'build') throw new Error('Usage: lume-cms build');
  const content = await compileContent();
  const counts = Object.entries(content.collections).map(([name, collection]) => `${name}: ${collection.entries.length}`);
  console.log(`Compiled ${counts.join(', ')}.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
