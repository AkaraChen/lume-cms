import { describe, expect, expectTypeOf, it } from 'vitest';
import { collection, createFumadocsSource, createFumadocsSources } from '../src/fumadocs.js';
import { definePlugin } from '../src/plugin.js';
import { schedule } from '../src/schedule.js';
import type { CompiledContent, CompiledEntry } from '../src/types.js';

const body = { markdown: '', code: '', toc: [], structuredData: { headings: [], contents: [] } };

function content(plugins: string[] = [], entries: CompiledEntry[] = []): CompiledContent {
  return { schemaVersion: 3, collections: { default: { plugins, entries } } };
}

describe('plugin runtime', () => {
  it('fails fast when compile and runtime plugin lists differ in either direction', () => {
    expect(() => createFumadocsSource(content(['schedule']))).toThrow(/compiled with plugin "schedule"/);
    expect(() => createFumadocsSource(content(), { plugins: [schedule()] })).toThrow(/Runtime plugin "schedule"/);
  });

  it('rejects duplicate ids', () => {
    expect(() => createFumadocsSource(content(['schedule', 'schedule']), {
      plugins: [schedule(), schedule()],
    })).toThrow(/Duplicate lume-cms plugin id/);
  });

  it('rejects legacy v1 and v2 content with a migration message', () => {
    expect(() => createFumadocsSource({ schemaVersion: 1, entries: [] } as never))
      .toThrow(/schema version 1; rebuild content/);
    expect(() => createFumadocsSource({ schemaVersion: 2, entries: [] } as never))
      .toThrow(/schema version 2; rebuild content/);
  });

  it('combines visibility with AND and falls back to slug ordering', async () => {
    const first = definePlugin({ id: 'first', runtime: { visible: () => true, compare: () => 0 } });
    const second = definePlugin({
      id: 'second',
      runtime: { visible: (entry: CompiledEntry) => entry.slug[0] !== 'hidden', compare: () => 0 },
    });
    const entries = ['z', 'hidden', 'a'].map((id) => ({
      slug: [id], path: `${id}.md`, draft: false, data: { title: id }, ext: {}, body,
    }));
    const source = createFumadocsSource(content(['first', 'second'], entries), { plugins: [first, second] });
    expect((await source.getSource()).getPages().map((page) => page.slugs[0])).toEqual(['a', 'z']);
  });

  it('adds schedule page data only when its plugin is registered', async () => {
    const scheduled = schedule();
    const source = createFumadocsSource(content(['schedule'], [{
      slug: ['page'], path: 'page.md', draft: false, data: { title: 'Page' },
      ext: { schedule: { publishDate: null, publishAtMs: null } }, body,
    }]), { plugins: [scheduled] });
    const page = (await source.getSource()).getPages()[0]!;
    expect(page.data.publishDate).toBeNull();
    expectTypeOf(page.data.publishDate).toEqualTypeOf<string | null>();

    const plain = createFumadocsSource(content([], [{
      slug: ['page'], path: 'page.md', draft: false, data: { title: 'Page' }, ext: {}, body,
    }]));
    const plainPage = (await plain.getSource()).getPages()[0]!;
    expect(plainPage.data).not.toHaveProperty('publishDate');
  });

  it('preserves plugin page-data types independently in nested collections', async () => {
    const sources = createFumadocsSources({
      schemaVersion: 3,
      collections: {
        blog: { plugins: ['schedule'], entries: [{
          slug: ['post'], path: 'post.md', draft: false, data: { title: 'Post' },
          ext: { schedule: { publishDate: null, publishAtMs: null } }, body,
        }] },
        docs: { plugins: [], entries: [{
          slug: ['page'], path: 'page.md', draft: false, data: { title: 'Page' }, ext: {}, body,
        }] },
      },
    }, {
      collections: {
        blog: collection({ baseUrl: '/blog', plugins: [schedule()] }),
        docs: collection({ baseUrl: '/docs', plugins: [] }),
      },
    }).sources;
    const blog = (await sources.blog.getSource()).getPages()[0]!;
    const docs = (await sources.docs.getSource()).getPages()[0]!;
    expectTypeOf(blog.data.publishDate).toEqualTypeOf<string | null>();
    expect(blog.data.publishDate).toBeNull();
    expect(docs.data).not.toHaveProperty('publishDate');
  });

  it('makes schedule ordering opt-in so meta and slug order remain authoritative by default', async () => {
    const entries = [
      {
        slug: ['a'], path: 'a.md', draft: false, data: { title: 'Older' },
        ext: { schedule: { publishDate: '1970-01-01T00:00:00.010Z', publishAtMs: 10 } }, body,
      },
      {
        slug: ['z'], path: 'z.md', draft: false, data: { title: 'Newer' },
        ext: { schedule: { publishDate: '1970-01-01T00:00:00.020Z', publishAtMs: 20 } }, body,
      },
    ];
    const normal = createFumadocsSource(content(['schedule'], entries), {
      now: () => new Date(30),
      plugins: [schedule()],
    });
    expect((await normal.getSource()).getPages().map((page) => page.slugs[0])).toEqual(['a', 'z']);

    const blog = createFumadocsSource(content(['schedule'], entries), {
      now: () => new Date(30),
      plugins: [schedule({ sort: 'date-desc' })],
    });
    expect((await blog.getSource()).getPages().map((page) => page.slugs[0])).toEqual(['z', 'a']);
  });
});
