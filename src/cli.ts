#!/usr/bin/env node
import { compileContent } from './compile.js';

async function main() {
  const command = process.argv[2] ?? 'build';
  if (command !== 'build') {
    console.error('Usage: lume-cms build');
    process.exitCode = 1;
    return;
  }
  const content = await compileContent();
  console.log(`Compiled ${content.entries.length} content entries.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
