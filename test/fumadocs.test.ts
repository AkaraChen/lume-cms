import { describe, expect, it } from 'vitest';
import { createFumadocsSource } from '../src/fumadocs.js';
import type { CompiledContent } from '../src/types.js';

function entry(id: string, publishAtMs: number | null, draft = false) {
  return {
    id,
    slug: [id],
    sourcePath: `content/${id}.md`,
    publishDate: publishAtMs === null ? null : new Date(publishAtMs).toISOString(),
    publishAtMs,
    draft,
    data: { title: id },
    body: { format: 'markdown' as const, markdown: id, html: `<p>${id}</p>`, toc: [] },
  };
}

function starterConsumerSets(source: Awaited<ReturnType<ReturnType<typeof createFumadocsSource>['getSource']>>) {
  const candidates = ['published', 'scheduled', 'draft'];
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
  it('invalidates at the publication deadline even with a long maxStaleMs', async () => {
    let now = 999;
    const content: CompiledContent = {
      schemaVersion: 1,
      entries: [{
        id: 'scheduled',
        slug: ['scheduled'],
        sourcePath: 'content/scheduled.md',
        publishDate: '1970-01-01T00:00:01Z',
        publishAtMs: 1_000,
        draft: false,
        data: { title: 'Scheduled' },
        body: { format: 'markdown', markdown: 'secret', html: '<p>secret</p>', toc: [] },
      }],
    };
    const source = createFumadocsSource(content, { now: () => new Date(now), maxStaleMs: 86_400_000 });
    expect((await source.getSource()).getPages()).toHaveLength(0);
    now = 1_000;
    expect((await source.getSource()).getPage(['scheduled'])?.data.title).toBe('Scheduled');
  });

  it('keeps the visible slug set identical across all seven starter paths plus RSS and sitemap', async () => {
    let now = 19;
    const source = createFumadocsSource({
      schemaVersion: 1,
      entries: [entry('published', 10), entry('scheduled', 20), entry('draft', null, true)],
    }, { now: () => new Date(now), maxStaleMs: 86_400_000 });

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
      schemaVersion: 1,
      get entries() {
        entryReads += 1;
        return entries;
      },
    };
    const source = createFumadocsSource(content, { now: () => new Date(now), maxStaleMs: 86_400_000 });
    entryReads = 0;

    await Promise.all(Array.from({ length: 20 }, () => source.getSource()));
    expect(entryReads).toBe(2);
    now = 20;
    await Promise.all(Array.from({ length: 20 }, () => source.getSource()));
    expect(entryReads).toBe(4);
  });
});
