import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('public exports', () => {
  it('publishes only the runtime source, config and build CLI', async () => {
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    expect(Object.keys(manifest.exports)).toEqual(['.', './config']);
    for (const target of Object.values(manifest.exports) as Array<Record<string, string>>) {
      expect(Object.keys(target)).toEqual(['types', 'import']);
      expect(target.types).toMatch(/\.d\.mts$/);
      expect(target.import).toMatch(/\.mjs$/);
    }
    expect(manifest.bin).toEqual({ 'lume-cms': './bin/lume-cms.mjs' });
  });
});
