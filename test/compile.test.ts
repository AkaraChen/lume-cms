import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import * as v from 'valibot';
import { z } from 'zod';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { CompileCache, compileContent, serializeCompiledContent } from '../src/compile.js';
import { defaultMetaSchema, defaultPageSchema } from '../src/config.js';
import { createFumadocsSource } from '../src/fumadocs.js';
import { schedule } from '../src/schedule.js';
import { definePlugin } from '../src/plugin.js';

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
  const page = (await createFumadocsSource(result).getSource()).getPages()[0]!;
  const Body = page.data.body;
  return renderToStaticMarkup(await (Body as (props: unknown) => Promise<ReactElement>)({ components }));
}

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('compileContent', () => {
  it('compiles isolated collections, permits cross-collection slugs, and emits deterministic v3 JSON', async () => {
    const cwd = await fixture({
      'content/docs/shared.mdx': '---\ntitle: Docs shared\n---\nDocs',
      'content/blog/shared.mdx': '---\ntitle: Blog shared\npublishDate: 2026-01-01T00:00:00Z\n---\nBlog',
    });
    const config = {
      collections: {
        docs: { root: 'content/docs', include: ['content/docs/**/*.mdx'], plugins: [] },
        blog: { root: 'content/blog', include: ['content/blog/**/*.mdx'], plugins: [schedule()] },
      },
    };
    const one = await compileContent({ cwd, write: false, config });
    const two = await compileContent({ cwd, write: false, config });

    expect(one.schemaVersion).toBe(3);
    expect(Object.keys(one.collections)).toEqual(['blog', 'docs']);
    expect(one.collections.docs?.entries[0]?.slug).toEqual(['shared']);
    expect(one.collections.blog?.entries[0]?.slug).toEqual(['shared']);
    expect(one.collections.docs?.plugins).toEqual([]);
    expect(one.collections.blog?.plugins).toEqual(['schedule']);
    expect(serializeCompiledContent(one)).toBe(serializeCompiledContent(two));
  });

  it('rejects a file included by two collections and names both owners', async () => {
    const cwd = await fixture({ 'content/shared.mdx': '---\ntitle: Shared\n---\nBody' });
    await expect(compileContent({
      cwd,
      write: false,
      config: {
        collections: {
          docs: { include: ['content/**/*.mdx'] },
          blog: { include: ['content/shared.mdx'] },
        },
      },
    })).rejects.toThrow(/both collections "blog" and "docs"|both collections "docs" and "blog"/);
  });

  it('normalizes deprecated content config to the same default collection', async () => {
    const cwd = await fixture({ 'content/page.md': '---\ntitle: Page\n---\nBody' });
    const legacy = await compileContent({ cwd, write: false, config: { content: {} } });
    const current = await compileContent({ cwd, write: false, config: { collections: { default: {} } } });
    expect(serializeCompiledContent(legacy)).toBe(serializeCompiledContent(current));
  });

  it('compiles frontmatter Markdown with a Valibot schema', async () => {
    const cwd = await fixture({
      'content/hello.md': '---\ntitle: Hello\npublishDate: 2026-09-01T10:00:00+08:00\n---\n# Heading\nBody',
    });
    const result = await compileContent({ cwd, write: false });
    expect(result.collections.default!.entries.map((item) => item.slug.join('/'))).toEqual(['hello']);
    expect(result.collections.default!.entries[0]?.body.toc).toEqual([{ title: 'Heading', url: '#heading', depth: 1 }]);
  });

  it('compiles and renders MDX with frontmatter and components', async () => {
    const cwd = await fixture({
      'content/component.mdx': '---\ntitle: Component\n---\n# MDX heading\n\n<Callout answer={40 + 2}>MDX body</Callout>',
    });
    const result = await compileContent({ cwd, write: false });
    const body = result.collections.default!.entries[0]!.body;
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
    const result = await compileContent({ cwd, write: false });
    const html = await renderBody(result);

    expect(html).toContain('<table>');
    expect(html).toContain('<del>removed</del>');
    expect(html).toContain('<a href="https://example.com">https://example.com</a>');
    expect(html).toContain('--shiki-light');
    expect(html).toContain('class="line"');
    // The TOC comes from `rehypeToc`, so its anchors are the rendered heading ids.
    for (const item of result.collections.default!.entries[0]!.body.toc) {
      expect(html).toContain(`id="${item.url.slice(1)}"`);
    }
  });

  it('uses the complete Fumadocs preset and native slug semantics', async () => {
    const cwd = await fixture({
      'content/(group)/你好.mdx': `---
title: Native preset
---
# Search heading

\`\`\`sh tab="npm"
npm install lume-cms
\`\`\`

\`\`\`sh tab="pnpm"
pnpm add lume-cms
\`\`\`
`,
    });
    const result = await compileContent({ cwd, write: false });

    expect(result.collections.default!.entries[0]?.slug).toEqual(['%E4%BD%A0%E5%A5%BD']);
    expect(result.collections.default!.entries[0]?.body.code).toContain('CodeBlockTabs');
    expect(result.collections.default!.entries[0]?.body.structuredData.headings[0]?.content).toBe('Search heading');
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
    expect(result.collections.default!.entries[0]?.data.title).toBe('Standard');
  });

  it('compiles structured search data and a root index page', async () => {
    const cwd = await fixture({
      'content/docs/index.mdx': '---\ntitle: Home\n---\n# Searchable heading\nBody',
    });
    const result = await compileContent({
      cwd,
      write: false,
      config: { content: { root: 'content/docs', include: ['content/docs/**/*.mdx'] } },
    });
    expect(result.collections.default!.entries[0]).toMatchObject({ slug: [], path: 'index.mdx' });
    expect(result.collections.default!.entries[0]?.body.structuredData.headings[0]?.content).toBe('Searchable heading');
    const source = await createFumadocsSource(result).getSource();
    const page = source.getPages()[0];
    expect(typeof page?.data.body).toBe('function');
    expect(page?.data.structuredData).toBeDefined();
    expect(source.getPageTree()).toBeDefined();
  });

  it('uses the official page schema while keeping draft and slug private', async () => {
    const cwd = await fixture({
      'content/page.mdx': `---
title: Official page
description: Description
icon: Book
full: true
_openapi:
  method: GET
tags:
  - docs
draft: true
slug: custom/path
unknown: stripped
---
Body`,
    });
    const result = await compileContent({ cwd, write: false });

    expect(result.collections.default!.entries[0]).toMatchObject({ slug: ['custom', 'path'], draft: true });
    expect(result.collections.default!.entries[0]?.data).toEqual({
      title: 'Official page',
      description: 'Description',
      icon: 'Book',
      full: true,
      _openapi: { method: 'GET' },
      tags: ['docs'],
    });
  });

  it('supports Zod-style extension and arbitrary Standard Schema replacement', async () => {
    const cwd = await fixture({
      'content/meta.json': '{"title":"Docs","badge":"new"}',
      'content/page.md': '---\ntitle: Extended\ncategory: docs\n---\nBody',
    });
    const extended = await compileContent({
      cwd,
      write: false,
      config: {
        content: {
          schema: defaultPageSchema.extend({ category: z.literal('docs') }),
          metaSchema: defaultMetaSchema.extend({ badge: z.string() }),
        },
      },
    });
    expect(extended.collections.default!.entries[0]?.data).toEqual({ title: 'Extended', category: 'docs' });
    expect(extended.collections.default!.metas?.[0]?.data).toEqual({ title: 'Docs', badge: 'new' });

    const replacement = v.object({ title: v.string(), score: v.number() });
    await writeFile(
      path.join(cwd, 'content/page.md'),
      '---\ntitle: Replaced\nscore: 42\ndraft: true\nslug: private/path\n---\nBody',
    );
    const replaced = await compileContent({
      cwd,
      write: false,
      config: { content: { schema: replacement } },
    });
    expect(replaced.collections.default!.entries[0]?.data).toEqual({ title: 'Replaced', score: 42 });
    expect(replaced.collections.default!.entries[0]).toMatchObject({ draft: true, slug: ['private', 'path'] });
  });

  it('rejects Zod defaults and transforms that reintroduce private page fields', async () => {
    const cwd = await fixture({
      'content/page.md': '---\ntitle: Page\ndraft: false\nslug: original/path\n---\nBody',
    });
    const schema = defaultPageSchema.extend({
      draft: z.boolean().default(true),
      slug: z.string().default('seed').transform(() => 'leak'),
    });

    await expect(compileContent({ cwd, write: false, config: { content: { schema } } }))
      .rejects.toThrow(/schema output: reserved private fields draft\/slug are forbidden/);
  });

  it('rejects arbitrary Standard Schema output that reintroduces a private page field', async () => {
    const cwd = await fixture({
      'content/page.md': '---\ntitle: Page\ndraft: true\nslug: original/path\n---\nBody',
    });
    const schema = {
      '~standard': {
        version: 1 as const,
        vendor: 'private-output-test',
        validate() {
          return { value: { title: 'Transformed', slug: 'leak' } };
        },
      },
    } satisfies StandardSchemaV1<unknown, Record<string, unknown>>;

    await expect(compileContent({ cwd, write: false, config: { content: { schema } } }))
      .rejects.toThrow(/schema output: reserved private fields draft\/slug are forbidden/);
  });

  it('collects deterministic meta.json files independently from the page include glob', async () => {
    const cwd = await fixture({
      'docs/meta.json': JSON.stringify({
        pagesIndex: 'intro',
        pages: ['intro', '---More---', '...'],
        defaultOpen: true,
        collapsible: false,
        root: true,
        icon: 'Book',
        description: 'Guide pages',
        title: 'Guide',
        unknown: 'stripped',
      }),
      'docs/intro.mdx': '---\ntitle: Intro\n---\nIntro',
      'docs/nested/meta.json': '{"title":"Nested"}',
      'docs/nested/page.mdx': '---\ntitle: Nested page\n---\nNested',
    });
    const config = { content: { root: 'docs', include: ['docs/**/*'] } };
    const one = await compileContent({ cwd, write: false, config });
    const two = await compileContent({ cwd, write: false, config });

    expect(one.collections.default!.metas).toEqual([
      {
        path: 'meta.json',
        data: {
          pagesIndex: 'intro',
          pages: ['intro', '---More---', '...'],
          defaultOpen: true,
          collapsible: false,
          root: true,
          icon: 'Book',
          description: 'Guide pages',
          title: 'Guide',
        },
      },
      { path: 'nested/meta.json', data: { title: 'Nested' } },
    ]);
    expect(serializeCompiledContent(one)).toBe(serializeCompiledContent(two));
  });

  it('reports malformed meta.json with its source path', async () => {
    const cwd = await fixture({ 'content/meta.json': '{ nope' });
    await expect(compileContent({ cwd, write: false }))
      .rejects.toThrow(/content\/meta\.json: invalid meta\.json/);
  });

  it('rejects values outside the official schemas and reserved private field types', async () => {
    const invalidPage = await fixture({
      'content/page.md': '---\ntitle: Page\nfull: wide\n---\nBody',
    });
    await expect(compileContent({ cwd: invalidPage, write: false }))
      .rejects.toThrow(/content\/page\.md: invalid frontmatter/);

    const invalidMeta = await fixture({
      'content/meta.json': '{"pages":[42]}',
      'content/page.md': '---\ntitle: Page\n---\nBody',
    });
    await expect(compileContent({ cwd: invalidMeta, write: false }))
      .rejects.toThrow(/content\/meta\.json: invalid meta\.json/);

    const invalidPrivate = await fixture({
      'content/page.md': '---\ntitle: Page\ndraft: yes\n---\nBody',
    });
    await expect(compileContent({
      cwd: invalidPrivate,
      write: false,
      config: { content: { schema: v.object({ title: v.string() }) } },
    })).rejects.toThrow(/invalid private frontmatter: draft must be a boolean/);
  });

  it('rejects invalid or offset-less dates', async () => {
    const cwd = await fixture({ 'content/date.md': '---\ntitle: Date\npublishDate: 2026-09-01\n---\nBody' });
    await expect(compileContent({ cwd, write: false, config: { plugins: [schedule()] } }))
      .rejects.toThrow(/content\/date\.md: invalid publishDate/);
  });

  it('normalizes equivalent timezone instants and produces deterministic bytes', async () => {
    const cwd = await fixture({
      'content/a.md': '---\ntitle: A\npublishDate: 2026-09-01T10:00:00+08:00\n---\nA',
      'content/b.md': '---\ntitle: B\npublishDate: 2026-09-01T02:00:00Z\n---\nB',
    });
    const config = { plugins: [schedule()] };
    const one = await compileContent({ cwd, write: false, config });
    const two = await compileContent({ cwd, write: false, config });
    expect((one.collections.default!.entries[0]?.ext.schedule as { publishAtMs: number }).publishAtMs)
      .toBe((one.collections.default!.entries[1]?.ext.schedule as { publishAtMs: number }).publishAtMs);
    expect(one.collections.default!.entries[0]?.data).not.toHaveProperty('publishDate');
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
    expect(output.collections.default.entries[0].slug).toEqual(['page']);
  });

  it('passes transformed and defaulted plugin schema output without a separate keys declaration', async () => {
    const cwd = await fixture({ 'content/page.md': '---\ntitle: Page\nsecret: hidden\n---\nBody' });
    const calls: string[] = [];
    const schema = v.object({
      secret: v.pipe(v.string(), v.transform((value) => value.toUpperCase())),
      mode: v.optional(v.string(), 'default-mode'),
    });
    const makePlugin = (id: string) => definePlugin({
      id,
      frontmatter: { schema },
      compile: {
        setup: () => { calls.push(`setup:${id}`); },
        entry: ({ frontmatter }: { frontmatter: Record<string, unknown> }) => {
          calls.push(`entry:${id}`);
          return { value: frontmatter.secret, mode: frontmatter.mode };
        },
        finalize: () => { calls.push(`finalize:${id}`); },
      },
    });
    const result = await compileContent({
      cwd,
      write: false,
      config: { plugins: [makePlugin('one'), makePlugin('two')] },
    });

    expect(calls).toEqual(['setup:one', 'setup:two', 'entry:one', 'entry:two', 'finalize:one', 'finalize:two']);
    expect(result.collections.default!.entries[0]?.data).toEqual({ title: 'Page' });
    expect(result.collections.default!.entries[0]?.ext).toEqual({
      one: { value: 'HIDDEN', mode: 'default-mode' },
      two: { value: 'HIDDEN', mode: 'default-mode' },
    });
  });

  it('incrementally compiles changed paths and keeps cached output byte-identical to a clean build', async () => {
    const cwd = await fixture({
      'content/a.md': '---\ntitle: A\n---\nA',
      'content/b.md': '---\ntitle: B\n---\nB',
    });
    const cache = new CompileCache();
    const entryCalls: string[] = [];
    let finalizeCalls = 0;
    const plugin = (cacheKey: string) => definePlugin({
      id: 'probe',
      compile: {
        cacheKey,
        entry({ sourcePath }) {
          entryCalls.push(sourcePath);
          return { cacheKey };
        },
        finalize(entries) {
          finalizeCalls += 1;
          for (const item of entries) item.data.finalized = ((item.data.finalized as number | undefined) ?? 0) + 1;
        },
      },
    });
    const config = { plugins: [plugin('v1')] };

    const first = await compileContent({ cwd, write: false, config, cache });
    expect(cache.stats).toEqual({ compiledEntries: 2, cachedEntries: 0 });
    expect(entryCalls).toEqual(['content/a.md', 'content/b.md']);
    expect(first.collections.default!.entries.map((item) => item.data.finalized)).toEqual([1, 1]);

    const second = await compileContent({ cwd, write: false, config, cache });
    expect(cache.stats).toEqual({ compiledEntries: 0, cachedEntries: 2 });
    expect(entryCalls).toHaveLength(2);
    expect(second.collections.default!.entries.map((item) => item.data.finalized)).toEqual([1, 1]);

    await writeFile(path.join(cwd, 'content/a.md'), '---\ntitle: A2\n---\nA2');
    const changed = await compileContent({ cwd, write: false, config, cache });
    expect(cache.stats).toEqual({ compiledEntries: 1, cachedEntries: 1 });
    expect(entryCalls.at(-1)).toBe('content/a.md');

    await import('node:fs/promises').then(({ rename }) => rename(
      path.join(cwd, 'content/b.md'),
      path.join(cwd, 'content/c.md'),
    ));
    const renamed = await compileContent({ cwd, write: false, config, cache });
    expect(cache.stats).toEqual({ compiledEntries: 1, cachedEntries: 1 });
    expect(renamed.collections.default!.entries.map((item) => item.slug.join('/'))).toEqual(['a', 'c']);

    const clean = await compileContent({ cwd, write: false, config, cache: new CompileCache() });
    expect(serializeCompiledContent(renamed)).toBe(serializeCompiledContent(clean));

    const changedPlugin = await compileContent({
      cwd,
      write: false,
      config: { plugins: [plugin('v2')] },
      cache,
    });
    expect(cache.stats).toEqual({ compiledEntries: 2, cachedEntries: 0 });
    expect(changedPlugin.collections.default!.entries.every(
      (item) => (item.ext.probe as { cacheKey: string }).cacheKey === 'v2',
    )).toBe(true);
    expect(finalizeCalls).toBe(6);
  });
});
