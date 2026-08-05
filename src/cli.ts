#!/usr/bin/env node
import { compileContent } from './compile.js';

async function main() {
  const command = process.argv[2] ?? 'build';
  if (command !== 'build') throw new Error('Usage: lume-cms build');
  const content = await compileContent();
  console.log(`Compiled ${content.entries.length} content entries.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
