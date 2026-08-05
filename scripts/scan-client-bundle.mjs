import { readFile } from 'node:fs/promises';
import fg from 'fast-glob';

const markers = process.argv.slice(2);
if (markers.length === 0) throw new Error('Pass one or more unpublished title/body markers to scan for');

for (const file of await fg('.next/static/**/*', { onlyFiles: true })) {
  const contents = await readFile(file, 'utf8').catch(() => '');
  for (const marker of markers) {
    if (contents.includes(marker)) throw new Error(`Unpublished marker found in client bundle: ${marker} (${file})`);
  }
}
console.log('No unpublished content found in .next/static.');
