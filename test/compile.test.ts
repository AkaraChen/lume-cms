import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import * as v from 'valibot';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { compileContent, serializeCompiledContent } from '../src/compile.js';
import { createContentSource } from '../src/source.js';

const dirs: string[] = [];

async function fixture(files: Record<string, string>) {
  const cwd = await mkdtemp(path.join(tmpdir(), 'lume-cms-'));
  dirs.push(cwd);
  for (const [name, value] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(cwd, name)), { recursive: true });
    await writeFile(path.join(cwd, name), value);
  }
  return cwd;
}

/** Render an entry the way Fumadocs does: through `page.data.body`. */
async function renderBody(
  result: Awaited<ReturnType<typeof compileContent>>,
  components?: Record<string, unknown>,
) {
  const files = await createContentSource(result).toDynamicSource().files();
  const Body = files.find((file) => file.type === 'page')!.data.body;
  return renderToStaticMarkup(await (Body as (props: unknown) => Promise<ReactElement>)({ components }));
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('compileContent', () => {
  it('compiles frontmatter Markdown and JSON with a Valibot schema', async () => {
    const cwd = await fixture({
      'content/hello.md': '---\ntitle: Hello\npublishDate: 2026-09-01T10:00:00+08:00\n---\n# Heading\nBody',
      'content/data.json': JSON.stringify({ title: 'JSON page', body: '# JSON body' }),
    });
    const result = await compileContent({ cwd, write: false });
    expect(result.entries.map((item) => item.id)).toEqual(['data', 'hello']);
    expect(result.entries[0]?.body.code).toContain('JSON body');
    expect(result.entries[1]?.body.toc).toEqual([{ title: 'Heading', url: '#heading', depth: 1 }]);
  });

  it('compiles and renders MDX with frontmatter and components', async () => {
    const cwd = await fixture({
      'content/component.mdx': '---\ntitle: Component\n---\n# MDX heading\n\n<Callout answer={40 + 2}>MDX body</Callout>',
    });
    const result = await compileContent({ cwd, write: false });
    const body = result.entries[0]!.body;
    expect(body.code).toContain('function _createMdxContent');
    expect(body.toc).toEqual([{ title: 'MDX heading', url: '#mdx-heading', depth: 1 }]);

    const html = await renderBody(result, {
      Callout: ({ answer, children }: { answer: number; children: unknown }) =>
        createElement('aside', null, `${answer}:`, children as never),
    });
    expect(html).toContain('<aside>42:MDX body</aside>');
  });

  it('preserves the starter GFM and Shiki MDX pipeline', async () => {
    const cwd = await fixture({
      'content/test.mdx': `---
title: Content probe
---
| Feature | State |
| --- | --- |
| GFM | enabled |

~~removed~~

https://example.com

\`\`\`js
const answer = 42;
\`\`\`
`,
    });
    let composedRemark = false;
    let composedRehype = false;
    const result = await compileContent({
      cwd,
      write: false,
      config: {
        remarkPlugins(defaults) {
          composedRemark = defaults.length >= 4;
          return defaults;
        },
        rehypePlugins(defaults) {
          composedRehype = defaults.length >= 2;
          return defaults;
        },
      },
    });
    const html = await renderBody(result);

    expect(composedRemark).toBe(true);
    expect(composedRehype).toBe(true);
    expect(html).toContain('<table>');
    expect(html).toContain('<del>removed</del>');
    expect(html).toContain('<a href="https://example.com">https://example.com</a>');
    expect(html).toContain('--shiki-light');
    expect(html).toContain('class="line"');
  });

  it('uses an injected Valibot schema and reports the source path on failure', async () => {
    const cwd = await fixture({ 'content/bad.md': '---\ntitle: Bad\ncategory: nope\n---\nBody' });
    await expect(compileContent({
      cwd,
      write: false,
      config: { content: { schema: v.looseObject({ title: v.string(), category: v.literal('docs') }) } },
    })).rejects.toThrow(/content\/bad\.md: invalid frontmatter/);
  });

  it('accepts the library-neutral Standard Schema interface', async () => {
    const cwd = await fixture({ 'content/page.md': '---\ntitle: Standard\n---\nBody' });
    const schema = {
      '~standard': {
        version: 1 as const,
        vendor: 'test',
        validate(value: unknown) {
          if (value && typeof value === 'object' && typeof (value as Record<string, unknown>).title === 'string') {
            return { value: value as Record<string, unknown> };
          }
          return { issues: [{ message: 'title is required' }] };
        },
      },
    } satisfies StandardSchemaV1<unknown, Record<string, unknown>>;

    const result = await compileContent({ cwd, write: false, config: { content: { schema } } });
    expect(result.entries[0]?.data.title).toBe('Standard');
  });

  it('compiles starter metadata, structured search data, and a root index page', async () => {
    const cwd = await fixture({
      'content/docs/index.mdx': '---\ntitle: Home\n---\n# Searchable heading\nBody',
      'content/docs/meta.json': JSON.stringify({ title: 'Docs', pages: ['index'] }),
    });
    const result = await compileContent({
      cwd,
      write: false,
      config: { content: { root: 'content/docs', include: ['content/docs/**/*.{mdx,json}'] } },
    });
    expect(result.entries[0]).toMatchObject({ id: 'index', slug: [], path: 'index.mdx' });
    expect(result.entries[0]?.body.structuredData.headings[0]?.content).toBe('Searchable heading');
    expect(result.metas).toEqual([{ path: 'meta.json', data: { title: 'Docs', pages: ['index'] } }]);
    const files = await createContentSource(result).toDynamicSource().files();
    expect(files.map((file) => file.type)).toEqual(['page', 'meta']);
    const page = files.find((file) => file.type === 'page');
    expect(typeof page?.data.body).toBe('function');
    expect(page?.data.structuredData).toBeDefined();
  });

  it('rejects invalid or offset-less dates unless defaultTimezone is configured', async () => {
    const cwd = await fixture({ 'content/date.md': '---\ntitle: Date\npublishDate: 2026-09-01\n---\nBody' });
    await expect(compileContent({ cwd, write: false })).rejects.toThrow(/content\/date\.md: invalid publishDate/);
    const result = await compileContent({ cwd, write: false, config: { defaultTimezone: 'Asia/Shanghai' } });
    expect(result.entries[0]?.publishAtMs).toBe(Date.parse('2026-08-31T16:00:00Z'));
  });

  it('normalizes equivalent timezone instants and produces deterministic bytes', async () => {
    const cwd = await fixture({
      'content/a.md': '---\ntitle: A\npublishDate: 2026-09-01T10:00:00+08:00\n---\nA',
      'content/b.md': '---\ntitle: B\npublishDate: 2026-09-01T02:00:00Z\n---\nB',
    });
    const one = await compileContent({ cwd, write: false });
    const two = await compileContent({ cwd, write: false });
    expect(one.entries[0]?.publishAtMs).toBe(one.entries[1]?.publishAtMs);
    expect(serializeCompiledContent(one)).toBe(serializeCompiledContent(two));
    expect(serializeCompiledContent(one)).not.toContain(cwd);
  });

  it('loads lume.config.ts through c12 and writes the configured output', async () => {
    const cwd = await fixture({
      'articles/page.md': '---\ntitle: Page\n---\nBody',
      'lume.config.ts': "export default { content: { root: 'articles', include: ['articles/**/*.md'] }, output: 'out.json' }",
    });
    await compileContent({ cwd });
    const output = JSON.parse(await readFile(path.join(cwd, 'out.json'), 'utf8'));
    expect(output.entries[0].id).toBe('page');
  });
});
