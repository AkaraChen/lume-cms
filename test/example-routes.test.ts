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

  it('statically generates docs while keeping schedule-dependent consumers dynamic', async () => {
    const files = await fg('examples/app/**/*.{ts,tsx}');
    const routes = await Promise.all(files.map(async (file) => ({
      file,
      source: await readFile(file, 'utf8'),
    })));
    const consumers = routes.filter(({ source }) => /get(?:Source|BlogSource|AllSources|AllPages)/.test(source));

    expect(consumers.map(({ file }) => file).sort()).toHaveLength(11);
    const docsOnly = consumers.filter(({ file }) => (
      file === 'examples/app/docs/layout.tsx'
      || file === 'examples/app/docs/[[...slug]]/page.tsx'
      || file === 'examples/app/og/docs/[...slug]/route.tsx'
      || file === 'examples/app/llms.mdx/docs/[[...slug]]/route.ts'
    ));
    expect(docsOnly).toHaveLength(4);
    for (const { file, source } of docsOnly) {
      expect(source, file).toContain('export const revalidate = false');
      expect(source, file).not.toContain('force-dynamic');
    }
    for (const { file, source } of docsOnly.filter(({ file }) => !file.endsWith('/layout.tsx'))) {
      expect(source, file).toContain('generateStaticParams');
    }

    const scheduleDependent = consumers.filter(({ file }) => !docsOnly.some((route) => route.file === file));
    expect(scheduleDependent).toHaveLength(7);
    for (const { file, source } of scheduleDependent) {
      expect(source, file).toContain("export const dynamic = 'force-dynamic'");
      expect(source, file).not.toMatch(/force-static|fetchCache|unstable_cache/);
    }

    for (const { file, source } of routes.filter(({ source }) => source.includes("force-dynamic"))) {
      expect(source, file).not.toMatch(/generateStaticParams|dynamicParams/);
    }

    const docsPage = docsOnly.find(({ file }) => file === 'examples/app/docs/[[...slug]]/page.tsx')?.source;
    expect(docsPage).not.toMatch(/draftMode|getPreviewSource/);
    const readme = await readFile('README.md', 'utf8');
    expect(readme).toContain("can keep the official starter's `revalidate = false` and `generateStaticParams()` model");
    expect(readme).toContain('route-segment `revalidate` values must be statically analyzable');
  });

  it('keeps preview reads out of statically generated public routes', async () => {
    const files = await fg('examples/app/**/*.{ts,tsx}');
    const previewConsumers = (await Promise.all(files.map(async (file) => ({
      file,
      source: await readFile(file, 'utf8'),
    })))).filter(({ source }) => source.includes('getPreviewSource'));

    expect(previewConsumers).toEqual([]);
  });
});
