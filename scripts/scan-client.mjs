import { readFile } from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';

const [appDir, ...markers] = process.argv.slice(2);
if (!appDir || markers.length === 0) {
  throw new Error('Usage: node scripts/scan-client.mjs <appDir> <marker...>');
}

const files = await fg('.next/static/**/*.{js,mjs,json,map}', {
  cwd: appDir,
  absolute: true,
  onlyFiles: true,
});
if (files.length === 0) throw new Error('Scanned 0 client bundle files');

for (const file of files) {
  const source = await readFile(file, 'utf8');
  for (const marker of markers) {
    if (source.includes(marker)) {
      throw new Error(`Unpublished marker ${JSON.stringify(marker)} found in ${path.relative(appDir, file)}`);
    }
  }
}

console.log(`Scanned ${files.length} client bundle files; no unpublished content found.`);
