#!/usr/bin/env node
import { compileContent } from './compile.js';
import { scanClientBundle } from './scan-client.js';

async function main() {
  const command = process.argv[2] ?? 'build';
  if (command === 'build') {
    const content = await compileContent();
    console.log(`Compiled ${content.entries.length} content entries.`);
  } else if (command === 'scan-client') {
    const appDir = process.argv[3];
    const markers = process.argv.slice(4);
    if (!appDir) throw new Error('Usage: lume-cms scan-client <appDir> <marker...>');
    const count = await scanClientBundle(appDir, markers);
    console.log(`Scanned ${count} client bundle files; no unpublished content found.`);
  } else {
    throw new Error('Usage: lume-cms <build | scan-client <appDir> <marker...>>');
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
