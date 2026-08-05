import { readFile } from 'node:fs/promises';
import fg from 'fast-glob';
import { describe, expect, it } from 'vitest';

describe('example request-time publishing contract', () => {
  it('gives every getSource route exactly the force-dynamic publishing model', async () => {
    const files = await fg('examples/app/**/*.{ts,tsx}');
    const routes = await Promise.all(files.map(async (file) => ({
      file,
      source: await readFile(file, 'utf8'),
    })));
    const consumers = routes.filter(({ source }) => source.includes('getSource'));

    expect(consumers.map(({ file }) => file).sort()).toHaveLength(9);
    for (const { file, source } of consumers) {
      expect(source, file).toContain("export const dynamic = 'force-dynamic'");
      expect(source, file).not.toMatch(/force-static|fetchCache|unstable_cache/);
    }

    for (const { file, source } of routes.filter(({ source }) => source.includes("force-dynamic"))) {
      expect(source, file).not.toMatch(/generateStaticParams|dynamicParams/);
    }

    expect(await readFile('README.md', 'utf8')).not.toMatch(/generateStaticParams|dynamicParams/);
  });
});
