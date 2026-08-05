import { readFile } from 'node:fs/promises';
import path from 'node:path';
import fg from 'fast-glob';

export async function scanClientBundle(appDir: string, markers: readonly string[]): Promise<number> {
  if (markers.length === 0 || markers.some((marker) => marker.length === 0)) {
    throw new Error('scan-client requires one or more non-empty unpublished content markers');
  }

  const cwd = path.resolve(appDir);
  const files = await fg('.next/static/**/*', { cwd, onlyFiles: true });
  if (files.length === 0) {
    throw new Error(`Scanned 0 files under ${path.join(cwd, '.next/static')} — wrong app directory or missing next build?`);
  }

  for (const file of files) {
    const contents = await readFile(path.join(cwd, file), 'utf8');
    for (const marker of markers) {
      if (contents.includes(marker)) {
        throw new Error(`Unpublished marker found in client bundle: ${marker} (${file})`);
      }
    }
  }
  return files.length;
}
