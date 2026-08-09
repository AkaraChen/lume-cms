import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('public exports', () => {
  it('publishes the runtime, config, Next.js, schedule, and CLI entries', async () => {
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    expect(Object.keys(manifest.exports)).toEqual(['.', './config', './next', './schedule']);
    for (const target of Object.values(manifest.exports) as Array<Record<string, string>>) {
      expect(Object.keys(target)).toEqual(['types', 'import']);
      expect(target.types).toMatch(/\.d\.mts$/);
      expect(target.import).toMatch(/\.mjs$/);
    }
    expect(manifest.bin).toEqual({ 'lume-cms': './bin/lume-cms.mjs' });
  });
});
