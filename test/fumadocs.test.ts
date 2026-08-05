import { AsyncLocalStorage } from 'node:async_hooks';
import { describe, expect, it } from 'vitest';
import type { Folder, Item, Node, Root } from 'fumadocs-core/page-tree';
import { collection, createFumadocsSource, createFumadocsSources } from '../src/fumadocs.js';
import { definePlugin, type PreviewContext } from '../src/plugin.js';
import type { CompiledContent, CompiledEntry } from '../src/types.js';
import { schedule } from '../src/schedule.js';

function entry(id: string, publishAtMs: number | null, draft = false) {
  return {
    slug: [id],
    path: `${id}.md`,
    draft,
    data: { title: id },
    ext: { schedule: { publishDate: publishAtMs === null ? null : new Date(publishAtMs).toISOString(), publishAtMs } },
    body: { markdown: id, code: '', toc: [], structuredData: { headings: [], contents: [] } },
  };
}

function starterConsumerSets(
  source: {
    getPage(slugs: string[]): unknown;
    getPages(): { slugs: string[] }[];
    getPageTree(): Root;
  },
  candidates = ['published', 'scheduled', 'draft'],
) {
  const direct = () => candidates.filter((slug) => source.getPage([slug])).sort();
  const enumerated = () => source.getPages().map((page) => page.slugs.join('/')).sort();
  const tree = JSON.stringify(source.getPageTree());
  return {
    detail: direct(),
    pageTree: candidates.filter((slug) => tree.includes(`/${slug}`)).sort(),
    search: enumerated(),
    llmsIndex: enumerated(),
    llmsFull: enumerated(),
    markdownProxy: direct(),
    og: direct(),
  };
}

describe('createFumadocsSource', () => {
  it('keeps an older frozen clock consistent after a newer scope crosses the deadline', async () => {
    const clock = new AsyncLocalStorage<number>();
    const source = createFumadocsSource({
      schemaVersion: 3,
      collections: { default: { plugins: ['schedule'], entries: [entry('scheduled', 20)] } },
    }, { now: () => new Date(clock.getStore()!), plugins: [schedule()] });

    const before = await clock.run(19, () => source.getSource());
    const after = await clock.run(20, () => source.getSource());
    const beforeAgain = await clock.run(19, () => source.getSource());

    expect(before.getPages()).toHaveLength(0);
    expect(after.getPages().map((page) => page.slugs[0])).toEqual(['scheduled']);
    expect(beforeAgain.getPages()).toHaveLength(0);
  });

  it('keeps concurrent interleaved frozen-clock scopes isolated', async () => {
    const clock = new AsyncLocalStorage<number>();
    const source = createFumadocsSource({
      schemaVersion: 3,
      collections: { default: { plugins: ['schedule'], entries: [entry('scheduled', 20)] } },
    }, { now: () => new Date(clock.getStore()!), plugins: [schedule()] });
    let signalBeforeRead!: () => void;
    let signalAfterRead!: () => void;
    const beforeRead = new Promise<void>((resolve) => { signalBeforeRead = resolve; });
    const afterRead = new Promise<void>((resolve) => { signalAfterRead = resolve; });

    const olderScope = clock.run(19, async () => {
      const first = await source.getSource();
      signalBeforeRead();
      await afterRead;
      const second = await source.getSource();
      return [first.getPages(), second.getPages()];
    });
    const newerScope = clock.run(20, async () => {
      await beforeRead;
      const current = await source.getSource();
      signalAfterRead();
      return current.getPages();
    });

    const [olderPages, newerPages] = await Promise.all([olderScope, newerScope]);
    expect(olderPages).toEqual([[], []]);
    expect(newerPages.map((page) => page.slugs[0])).toEqual(['scheduled']);
  });

  it('creates isolated sources and a visibility-safe union across collections', async () => {
    let now = 19;
    const result = createFumadocsSources({
      schemaVersion: 3,
      collections: {
        docs: { plugins: ['schedule'], entries: [entry('shared', 10), entry('docs-later', 20)] },
        blog: { plugins: ['schedule'], entries: [entry('shared', 10), entry('blog-later', 30)] },
      },
    }, {
      now: () => new Date(now),
      collections: {
        docs: collection({ baseUrl: '/docs', plugins: [schedule()] }),
        blog: collection({ baseUrl: '/blog', plugins: [schedule()] }),
      },
    });

    expect((await result.sources.docs.getSource()).getPages().map((page) => page.url)).toEqual(['/docs/shared']);
    expect((await result.sources.blog.getSource()).getPages().map((page) => page.url)).toEqual(['/blog/shared']);
    const docsBefore = await result.sources.docs.getSource();
    const blogBefore = await result.sources.blog.getSource();
    expect(Object.values(starterConsumerSets(docsBefore, ['shared', 'docs-later']))).toEqual(Array(7).fill(['shared']));
    expect(Object.values(starterConsumerSets(blogBefore, ['shared', 'blog-later']))).toEqual(Array(7).fill(['shared']));
    expect((await result.getAllPages()).map((page) => page.url).sort()).toEqual(['/blog/shared', '/docs/shared']);
    now = 20;
    const docsAfter = await result.sources.docs.getSource();
    const blogAfter = await result.sources.blog.getSource();
    expect(Object.values(starterConsumerSets(docsAfter, ['shared', 'docs-later']))).toEqual(Array(7).fill(['docs-later', 'shared']));
    expect(Object.values(starterConsumerSets(blogAfter, ['shared', 'blog-later']))).toEqual(Array(7).fill(['shared']));
    expect((await result.getAllPages()).map((page) => page.url).sort()).toEqual(['/blog/shared', '/docs/docs-later', '/docs/shared']);
  });

  it('keeps preview loaders isolated by collection and from every public generation', async () => {
    const result = createFumadocsSources({
      schemaVersion: 3,
      collections: {
        docs: { plugins: [], entries: [entry('docs-draft', null, true)] },
        blog: { plugins: [], entries: [entry('blog-draft', null, true)] },
      },
    }, {
      collections: {
        docs: collection({ baseUrl: '/docs' }),
        blog: collection({ baseUrl: '/blog' }),
      },
    });

    expect((await result.getAllPages())).toEqual([]);
    expect((await result.sources.docs.getPreviewSource({ draft: true })).getPages().map((page) => page.url))
      .toEqual(['/docs/docs-draft']);
    expect((await result.sources.blog.getPreviewSource({ draft: true })).getPages().map((page) => page.url))
      .toEqual(['/blog/blog-draft']);
    expect((await result.sources.docs.getSource()).getPages()).toEqual([]);
    expect((await result.sources.blog.getSource()).getPages()).toEqual([]);
  });

  it('fails fast for mismatched collection sets, duplicate base URLs, and plural use of the singular API', () => {
    const content: CompiledContent = {
      schemaVersion: 3,
      collections: {
        docs: { plugins: [], entries: [] },
        blog: { plugins: [], entries: [] },
      },
    };
    expect(() => createFumadocsSources(content, { collections: { docs: collection({}) } }))
      .toThrow(/must match exactly/);
    expect(() => createFumadocsSources(content, {
      collections: { docs: collection({ baseUrl: '/same' }), blog: collection({ baseUrl: '/same' }) },
    })).toThrow(/same baseUrl/);
    expect(() => createFumadocsSource(content)).toThrow(/exactly one compiled collection/);
  });

  it('falls back to source Markdown for artifacts without processed Markdown', async () => {
    const source = await createFumadocsSource({
      schemaVersion: 3,
      collections: {
        default: { i18n: undefined, plugins: [], entries: [entry('legacy', null)] },
      },
    }).getSource();

    expect(source.getPage(['legacy'])?.data).toMatchObject({
      content: 'legacy',
      processedMarkdown: 'legacy',
    });
  });

  it('invalidates exactly at the publication deadline', async () => {
    let now = 999;
    const content: CompiledContent = {
      schemaVersion: 3,
      collections: { default: { plugins: ['schedule'], entries: [{
        slug: ['scheduled'],
        path: 'scheduled.md',
        draft: false,
        data: { title: 'Scheduled' },
        ext: { schedule: { publishDate: '1970-01-01T00:00:01Z', publishAtMs: 1_000 } },
        body: { markdown: 'secret', code: '', toc: [], structuredData: { headings: [], contents: [] } },
      }] } },
    };
    const source = createFumadocsSource(content, { now: () => new Date(now), plugins: [schedule()] });
    expect((await source.getSource()).getPages()).toHaveLength(0);
    now = 1_000;
    expect((await source.getSource()).getPage(['scheduled'])?.data.title).toBe('Scheduled');
  });

  it('keeps the visible slug set identical across all seven starter paths plus RSS and sitemap', async () => {
    let now = 19;
    const source = createFumadocsSource({
      schemaVersion: 3,
      collections: { default: {
        plugins: ['schedule'],
        entries: [entry('published', 10), entry('scheduled', 20), entry('draft', null, true)],
      } },
    }, { now: () => new Date(now), plugins: [schedule()] });

    const before = await source.getSource();
    expect(Object.values(starterConsumerSets(before))).toEqual(Array(7).fill(['published']));
    expect(before.getPages().map((page) => page.slugs.join('/'))).toEqual(['published']); // RSS and sitemap
    now = 20;
    const after = await source.getSource();
    expect(Object.values(starterConsumerSets(after))).toEqual(Array(7).fill(['published', 'scheduled']));
    expect(after.getPages().map((page) => page.slugs.join('/')).sort()).toEqual(['published', 'scheduled']);
  });

  it('previews only the explicitly requested draft and future dimensions', async () => {
    const factory = createFumadocsSource({
      schemaVersion: 3,
      collections: { default: { i18n: undefined, plugins: ['schedule'], entries: [
          entry('public', null),
          entry('draft', null, true),
          entry('future', 20),
          entry('draft-future', 20, true),
        ] } },
    }, { now: () => new Date(10), plugins: [schedule()] });
    const slugs = async (options?: Parameters<typeof factory.getPreviewSource>[0]) =>
      (await factory.getPreviewSource(options)).getPages().map((page) => page.slugs[0]).sort();

    expect((await factory.getSource()).getPages().map((page) => page.slugs[0])).toEqual(['public']);
    expect(await slugs()).toEqual(['public']);
    expect(await slugs({ draft: true })).toEqual(['draft', 'public']);
    expect(await slugs({ future: true })).toEqual(['future', 'public']);
    expect(await slugs({ draft: true, future: true })).toEqual([
      'draft',
      'draft-future',
      'future',
      'public',
    ]);
    expect(await factory.getPreviewSource()).not.toBe(await factory.getPreviewSource());
  });

  it('keeps preview loaders isolated from the public deadline and coalesced refresh state', async () => {
    let now = 10;
    let deadlineCalls = 0;
    const previewContexts: Array<PreviewContext | undefined> = [];
    const observed = definePlugin({
      id: 'observed',
      runtime: {
        visible(_entry, context) {
          previewContexts.push(context.preview);
          return true;
        },
        deadline(_entries, { nowMs }) {
          deadlineCalls += 1;
          return nowMs < 20 ? 20 : Infinity;
        },
      },
    });
    const factory = createFumadocsSource({
      schemaVersion: 3,
      collections: { default: {
        i18n: undefined,
        plugins: ['schedule', 'observed'],
        entries: [entry('future', 20)],
      } },
    }, { now: () => new Date(now), plugins: [schedule(), observed] });

    expect((await factory.getSource()).getPage(['future'])).toBeUndefined();
    expect(deadlineCalls).toBe(1);

    const preview = await factory.getPreviewSource({ future: true });
    expect(preview.getPage(['future'])).toBeDefined();
    expect(previewContexts.at(-1)).toEqual({ draft: false, future: true, expired: false });
    expect(deadlineCalls).toBe(1);

    expect((await factory.getSource()).getPage(['future'])).toBeUndefined();
    expect(deadlineCalls).toBe(1);
    now = 20;
    const [concurrentPreview, ...refreshed] = await Promise.all([
      factory.getPreviewSource({ future: true }),
      ...Array.from({ length: 20 }, () => factory.getSource()),
    ]);
    expect(concurrentPreview.getPage(['future'])).toBeDefined();
    expect(refreshed.every((source) => source.getPage(['future']) !== undefined)).toBe(true);
    expect(deadlineCalls).toBe(2);
    expect(previewContexts.some((context) => context === undefined)).toBe(true);
  });

  it('does not bypass third-party visibility plugins that ignore preview context', async () => {
    const trustedOnly = definePlugin({
      id: 'trusted-only',
      runtime: { visible: (candidate: CompiledEntry) => candidate.slug[0] !== 'hidden' },
    });
    const factory = createFumadocsSource({
      schemaVersion: 3,
      collections: { default: {
        i18n: undefined,
        plugins: ['schedule', 'trusted-only'],
        entries: [entry('hidden', 20, true), entry('visible', 20, true)],
      } },
    }, { now: () => new Date(10), plugins: [schedule(), trustedOnly] });

    const preview = await factory.getPreviewSource({ draft: true, future: true, expired: true });
    expect(preview.getPage(['hidden'])).toBeUndefined();
    expect(preview.getPage(['visible'])).toBeDefined();
  });

  it('coalesces concurrent refreshes at the same publication boundary', async () => {
    let now = 19;
    let entryReads = 0;
    const entries = [entry('scheduled', 20)];
    const content: CompiledContent = {
      schemaVersion: 3,
      collections: { default: {
        plugins: ['schedule'],
        get entries() {
          entryReads += 1;
          return entries;
        },
      } },
    };
    const source = createFumadocsSource(content, { now: () => new Date(now), plugins: [schedule()] });
    entryReads = 0;

    await Promise.all(Array.from({ length: 20 }, () => source.getSource()));
    expect(entryReads).toBe(2);
    now = 20;
    await Promise.all(Array.from({ length: 20 }, () => source.getSource()));
    expect(entryReads).toBe(4);
  });

  it('preserves the complete Fumadocs meta page-tree contract across a deadline', async () => {
    let now = 19;
    const pages = [
      entry('root-page', null),
      { ...entry('intro', null), slug: ['guide', 'intro'], path: 'guide/intro.mdx' },
      { ...entry('advanced-a', null), slug: ['guide', 'advanced', 'a'], path: 'guide/advanced/a.mdx' },
      { ...entry('advanced-b', null), slug: ['guide', 'advanced', 'b'], path: 'guide/advanced/b.mdx' },
      { ...entry('hidden', null), slug: ['guide', 'hidden'], path: 'guide/hidden.mdx' },
      { ...entry('tail', 20), slug: ['guide', 'tail'], path: 'guide/tail.mdx' },
    ];
    const sourceFactory = createFumadocsSource({
      schemaVersion: 3,
      collections: { default: { plugins: ['schedule'], entries: pages, metas: [
        {
          path: 'meta.json',
          data: { title: 'Docs', description: 'Root docs', pages: ['guide', 'root-page'] },
        },
        {
          path: 'guide/meta.json',
          data: {
            title: 'Guide',
            description: 'Guide pages',
            icon: 'Book',
            root: true,
            defaultOpen: true,
            pagesIndex: 'intro',
            pages: [
              '---Basics---',
              '...advanced',
              '!hidden',
              '[External](https://example.com)',
              '[Rocket][Icon Link](https://icons.example.com)',
              '...',
            ],
          },
        },
        { path: 'guide/advanced/meta.json', data: { pages: ['b', 'a'] } },
      ] } },
    }, { now: () => new Date(now), plugins: [schedule()] });

    const before = await sourceFactory.getSource();
    const tree = before.getPageTree();
    expect(tree).toMatchObject({ name: 'Docs', description: 'Root docs' });
    const guide = tree.children[0] as Folder;
    expect(guide).toMatchObject({
      type: 'folder',
      name: 'Guide',
      description: 'Guide pages',
      icon: 'Book',
      root: true,
      defaultOpen: true,
      index: { type: 'page', name: 'intro', url: '/guide/intro' },
    });
    expect(guide.children.map((node: Node) => ({
      type: node.type,
      name: node.name,
      url: node.type === 'page' ? node.url : undefined,
      icon: 'icon' in node ? node.icon : undefined,
    }))).toEqual([
      { type: 'separator', name: 'Basics', url: undefined, icon: undefined },
      { type: 'page', name: 'advanced-b', url: '/guide/advanced/b', icon: undefined },
      { type: 'page', name: 'advanced-a', url: '/guide/advanced/a', icon: undefined },
      { type: 'page', name: 'External', url: 'https://example.com', icon: undefined },
      { type: 'page', name: 'Icon Link', url: 'https://icons.example.com', icon: 'Rocket' },
    ]);
    expect(before.getNodeMeta(tree)).toMatchObject({ path: 'meta.json', data: { title: 'Docs' } });
    expect(before.getNodeMeta(guide)).toMatchObject({
      path: 'guide/meta.json',
      data: { title: 'Guide', pagesIndex: 'intro', root: true },
    });
    expect(guide.children.some((node: Node) => node.type === 'page' && node.name === 'hidden')).toBe(false);

    now = 20;
    const after = await sourceFactory.getSource();
    const refreshedGuide = after.getPageTree().children[0] as Folder;
    expect((refreshedGuide.children.at(-1) as Item).url).toBe('/guide/tail');
  });

  it('applies official loader options to the visible snapshot and every public read path', async () => {
    let now = 19;
    const storageSnapshots: string[][] = [];
    const slugInputs: string[] = [];
    const sourceFactory = createFumadocsSource({
      schemaVersion: 3,
      collections: { default: { plugins: ['schedule'], entries: [
        { ...entry('published', 10), data: { title: 'Zulu', icon: 'Book' } },
        { ...entry('scheduled', 20), data: { title: 'Alpha', icon: 'Rocket' } },
        { ...entry('draft', null, true), data: { title: 'Draft', icon: 'Lock' } },
      ] } },
    }, {
      now: () => new Date(now),
      plugins: [schedule()],
      url: (slugs) => `/custom/${slugs.join('~')}`,
      slugs(file) {
        slugInputs.push(file.path);
        return [String(file.data.title).toLowerCase()];
      },
      icon: (name) => name ? `icon:${name}` : undefined,
      pageTree: {
        idPrefix: 'cms',
        noRef: true,
        sort: { by: 'name' },
        context: { prefix: 'Tree ' },
        transformers: [{
          file(node) {
            return { ...node, name: `${String(this.custom?.prefix)}${String(node.name)}` };
          },
        }],
      },
      loaderPlugins: ({ typedPlugin }) => [typedPlugin({
        transformStorage({ storage }) {
          storageSnapshots.push(storage.getFiles().filter((path) => storage.read(path)?.format === 'page'));
        },
      })],
    });

    const before = await sourceFactory.getSource();
    expect(before.getPages().map(({ slugs, url }) => ({ slugs, url }))).toEqual([
      { slugs: ['zulu'], url: '/custom/zulu' },
    ]);
    expect(before.getPage(['zulu'])?.url).toBe('/custom/zulu');
    expect(before.getPage(['published'])).toBeUndefined();
    expect(before.getPageTree()).toMatchObject({
      $id: 'cms:root',
      children: [{ name: 'Tree Zulu', icon: 'icon:Book', url: '/custom/zulu' }],
    });
    expect(JSON.stringify(before.getPageTree())).not.toContain('$ref');
    expect(slugInputs).toEqual(['published.md']);
    expect(storageSnapshots).toEqual([['published.md']]);

    now = 20;
    const after = await sourceFactory.getSource();
    expect(after.getPages().map(({ slugs, url }) => ({ slugs, url }))).toEqual([
      { slugs: ['zulu'], url: '/custom/zulu' },
      { slugs: ['alpha'], url: '/custom/alpha' },
    ]);
    expect(after.getPageTree().children.map((node) => node.type === 'page' ? node.url : undefined)).toEqual([
      '/custom/alpha',
      '/custom/zulu',
    ]);
    expect(slugInputs).toEqual(['published.md', 'published.md', 'scheduled.md']);
    expect(storageSnapshots).toEqual([['published.md'], ['published.md', 'scheduled.md']]);
  });

  it('rejects pageTree.url so page and navigation URLs cannot drift', () => {
    expect(() => createFumadocsSource({
      schemaVersion: 3,
      collections: { default: { plugins: [], entries: [entry('page', null)] } },
    }, {
      pageTree: { url: () => '/split' } as never,
    })).toThrow(/pageTree\.url is unsupported; use the top-level url option/);
  });

  it('falls back from a custom slug callback to the compiled slug', async () => {
    const page = { ...entry('file-name', null), slug: ['frontmatter-slug'] };
    const source = await createFumadocsSource({
      schemaVersion: 3,
      collections: { default: { plugins: [], entries: [page] } },
    }, { slugs: () => undefined }).getSource();

    expect(source.getPage(['frontmatter-slug'])?.path).toBe('file-name.md');
    expect(source.getPage(['file-name'])).toBeUndefined();
  });
});
