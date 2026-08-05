import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('public exports', () => {
  it('keeps unsafe access isolated in its own export path', async () => {
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    expect(Object.keys(manifest.exports)).toEqual(['.', './compile', './config', './fumadocs', './unsafe']);
    for (const target of Object.values(manifest.exports) as Array<Record<string, string>>) {
      expect(Object.keys(target)).toEqual(['types', 'import']);
      expect(target.types).toMatch(/\.d\.mts$/);
      expect(target.import).toMatch(/\.mjs$/);
    }
    expect(manifest.bin).toEqual({ 'lume-cms': './bin/lume-cms.mjs' });
    const main = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
    expect(main).not.toContain('unsafe_');
  });
});
