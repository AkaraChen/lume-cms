import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('public exports', () => {
  it('publishes the runtime, config, API, Next.js, schedule, and CLI entries', async () => {
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    expect(Object.keys(manifest.exports)).toEqual(['.', './config', './api', './next', './schedule']);
    for (const target of Object.values(manifest.exports) as Array<Record<string, string>>) {
      expect(Object.keys(target)).toEqual(['types', 'import']);
      expect(target.types).toMatch(/\.d\.mts$/);
      expect(target.import).toMatch(/\.mjs$/);
    }
    expect(manifest.bin).toEqual({ 'lume-cms': './bin/lume-cms.mjs' });
    expect(manifest.peerDependencies.hono).toBe('^4.0.0');
    expect(manifest.peerDependenciesMeta.hono).toEqual({ optional: true });
  });
});
