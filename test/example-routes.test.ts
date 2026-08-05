import { readFile } from 'node:fs/promises';
import fg from 'fast-glob';
import { describe, expect, it } from 'vitest';

describe('example request-time publishing contract', () => {
  it('uses processed Markdown for full and per-page text exports', async () => {
    const source = await readFile('examples/lib/source.ts', 'utf8');
    expect(source).toContain('page.data.processedMarkdown');
    expect(source).not.toContain('${page.data.content}');

    for (const file of [
      'examples/app/llms-full.txt/route.ts',
      'examples/app/llms.mdx/docs/[[...slug]]/route.ts',
    ]) {
      expect(await readFile(file, 'utf8'), file).toContain('getLLMText');
    }
  });

  it('gives every getSource route exactly the force-dynamic publishing model', async () => {
    const files = await fg('examples/app/**/*.{ts,tsx}');
    const routes = await Promise.all(files.map(async (file) => ({
      file,
      source: await readFile(file, 'utf8'),
    })));
    const consumers = routes.filter(({ source }) => /get(?:Source|BlogSource|AllSources|AllPages)/.test(source));

    expect(consumers.map(({ file }) => file).sort()).toHaveLength(11);
    for (const { file, source } of consumers) {
      expect(source, file).toContain("export const dynamic = 'force-dynamic'");
      expect(source, file).not.toMatch(/force-static|fetchCache|unstable_cache/);
    }

    for (const { file, source } of routes.filter(({ source }) => source.includes("force-dynamic"))) {
      expect(source, file).not.toMatch(/generateStaticParams|dynamicParams/);
    }

    expect(await readFile('README.md', 'utf8')).not.toMatch(/generateStaticParams|dynamicParams/);
  });

  it('limits preview reads to the draftMode-guarded docs detail request', async () => {
    const files = await fg('examples/app/**/*.{ts,tsx}');
    const previewConsumers = (await Promise.all(files.map(async (file) => ({
      file,
      source: await readFile(file, 'utf8'),
    })))).filter(({ source }) => source.includes('getPreviewSource'));

    expect(previewConsumers.map(({ file }) => file)).toEqual(['examples/app/docs/[[...slug]]/page.tsx']);
    expect(previewConsumers[0]?.source).toContain("import { draftMode } from 'next/headers'");
    expect(previewConsumers[0]?.source).toMatch(/\(await draftMode\(\)\)\.isEnabled/);
    expect(previewConsumers[0]?.source).toMatch(/preview\s*\? await getPreviewSource/);
  });
});
