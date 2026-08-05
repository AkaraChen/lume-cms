import { AsyncLocalStorage } from 'node:async_hooks';
import { describe, expect, it } from 'vitest';
import { collection, createFumadocsSource, createFumadocsSources } from '../src/fumadocs.js';
import type { CompiledContent } from '../src/types.js';
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
  source: Awaited<ReturnType<ReturnType<typeof createFumadocsSource>['getSource']>>,
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
});
