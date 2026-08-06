import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { collection, createFumadocsSource, createFumadocsSources } from '../src/index.js';
import {
  composeOnion,
  definePlugin,
  type Next,
  type ResolvedEntry,
  type RuntimeContext,
} from '../src/plugin.js';
import { schedule } from '../src/schedule.js';
import type { CompiledContent, CompiledEntry } from '../src/types.js';

const body = { markdown: '', processedMarkdown: '', code: '', toc: [], structuredData: { headings: [], contents: [] } };

function content(plugins: string[] = [], entries: CompiledEntry[] = []): CompiledContent {
  return { schemaVersion: 3, collections: { default: { baseUrl: '/', plugins, entries, metas: [] } } };
}

describe('plugin runtime', () => {
  afterEach(() => vi.useRealTimers());
  it('composes middleware outside-in and rejects repeated next calls', () => {
    const events: string[] = [];
    const layer = (name: string) => (_value: string, next: () => string) => {
      events.push(`${name}:before`);
      const result = next();
      events.push(`${name}:after`);
      return result;
    };
    const run = composeOnion([layer('a'), layer('b')], (value: string) => {
      events.push('core');
      return value.toUpperCase();
    });
    expect(run('ok')).toBe('OK');
    expect(events).toEqual(['a:before', 'b:before', 'core', 'b:after', 'a:after']);

    const repeated = composeOnion([
      (_value: string, next: () => string) => `${next()}${next()}`,
    ], (value: string) => value);
    expect(() => repeated('x')).toThrow(/more than once/);

    const shortCircuit = composeOnion([
      (_value: string, _next: () => string) => 'owned',
    ], () => 'core');
    expect(shortCircuit('x')).toBe('owned');
  });

  it('fails fast when compile and runtime plugin lists differ in either direction', () => {
    expect(() => createFumadocsSource(content(['schedule']))).toThrow(/compiled with build plugin "schedule"/);
    expect(() => createFumadocsSource(content(), { collections: { default: { plugins: [schedule()] } } })).toThrow(/Build plugin "schedule"/);
  });

  it('runs resolve, list, and deadline as outside-in middleware around shared cores', async () => {
    const events: string[] = [];
    const middleware = (id: string) => definePlugin({
      id,
      runtime: {
        resolve(entry: ResolvedEntry, context: RuntimeContext, next: Next<void>) {
          events.push(`${id}:resolve:before`);
          next();
          events.push(`${id}:resolve:after`);
        },
        list(entries: readonly ResolvedEntry[], context: RuntimeContext, next: Next<ResolvedEntry[]>) {
          events.push(`${id}:list:before`);
          const result = next();
          events.push(`${id}:list:after`);
          return result;
        },
        deadline(entries: readonly ResolvedEntry[], context: RuntimeContext, next: Next<number>) {
          events.push(`${id}:deadline:before`);
          const result = next();
          events.push(`${id}:deadline:after`);
          return result;
        },
      },
    });
    const entry = {
      slug: ['page'], path: 'page.md', draft: false, data: { title: 'Page' }, ext: {}, body,
    };
    await createFumadocsSource(content(['a', 'b'], [entry]), {
      collections: { default: { plugins: [middleware('a'), middleware('b')] } },
    }).getSource();
    expect(events).toEqual([
      'a:resolve:before', 'b:resolve:before', 'b:resolve:after', 'a:resolve:after',
      'a:list:before', 'b:list:before', 'b:list:after', 'a:list:after',
      'a:deadline:before', 'b:deadline:before', 'b:deadline:after', 'a:deadline:after',
    ]);
  });

  it('shares hide reasons across all reads and only reveals every requested reason', async () => {
    const marker = definePlugin({
      id: 'marker',
      runtime: {
        resolve(entry: ResolvedEntry, _context: RuntimeContext, next: Next<void>) {
          next();
          entry.hide('one');
          entry.hide('two');
          entry.set('private', true);
          expect(entry.get('private')).toBe(true);
        },
      },
    });
    const source = createFumadocsSource(content(['marker'], [{
      slug: ['hidden'], path: 'hidden.md', draft: false, data: { title: 'Hidden' }, ext: {}, body,
    }]), { collections: { default: { plugins: [marker] } } });
    expect((await source.getSource()).getPages()).toHaveLength(0);
    expect((await source.getPreviewSource({ reveal: ['one'] })).getPages()).toHaveLength(0);
    expect((await source.getPreviewSource({ reveal: ['one', 'two'] })).getPages()).toHaveLength(1);
  });

  it('isolates runtime state per generation and protects the compiled artifact', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10);
    let resolutions = 0;
    const compiledSnapshots: Readonly<CompiledEntry>[] = [];
    const original = {
      slug: ['page'], path: 'page.md', draft: false, data: { title: 'Original' }, ext: {}, body,
    };
    const gate = definePlugin({
      id: 'gate',
      runtime: {
        timeDependent: true,
        resolve(entry: ResolvedEntry, { nowMs }: RuntimeContext, next: Next<void>) {
          compiledSnapshots.push(entry.compiled);
          expect(entry.get('seen')).toBeUndefined();
          entry.set('seen', true);
          resolutions += 1;
          expect(() => {
            (entry.compiled.data as Record<string, unknown>).title = 'Mutated';
          }).toThrow();
          next();
          if (nowMs < 20) entry.hide('future');
        },
        deadline(_entries: readonly ResolvedEntry[], { nowMs }: RuntimeContext, next: Next<number>) {
          return Math.min(next(), nowMs < 20 ? 20 : Infinity);
        },
      },
    });
    const source = createFumadocsSource(content(['gate'], [original]), {
      collections: { default: { plugins: [gate] } },
    });
    expect((await source.getSource()).getPages()).toHaveLength(0);
    vi.setSystemTime(20);
    expect((await source.getSource()).getPages()).toHaveLength(1);
    expect(resolutions).toBe(2);
    expect(compiledSnapshots[1]).toBe(compiledSnapshots[0]);
    expect(original.data.title).toBe('Original');
  });

  it('rejects incomplete time-dependent and invalid list middleware', () => {
    const entry = {
      slug: ['page'], path: 'page.md', draft: false, data: { title: 'Page' }, ext: {}, body,
    };
    const incomplete = definePlugin({ id: 'incomplete', runtime: { timeDependent: true } });
    expect(() => createFumadocsSource(content(['incomplete'], [entry]), { collections: { default: { plugins: [incomplete] } } }))
      .toThrow(/must provide a deadline/);

    const invalid = definePlugin({
      id: 'invalid',
      runtime: {
        list(_entries: readonly ResolvedEntry[], _context: RuntimeContext, _next: Next<ResolvedEntry[]>) {
          return undefined as never;
        },
      },
    });
    const source = createFumadocsSource(content(['invalid'], [entry]), { collections: { default: { plugins: [invalid] } } });
    expect(() => source.getSource()).toThrow(/must return an entry array/);
  });

  it('rejects duplicate ids', () => {
    expect(() => createFumadocsSource(content(['schedule', 'schedule']), {
      collections: { default: { plugins: [schedule(), schedule()] } },
    })).toThrow(/Duplicate lume-cms plugin id/);
  });

  it('rejects unsupported compiled schemas', () => {
    expect(() => createFumadocsSource({ schemaVersion: 1, entries: [] } as never))
      .toThrow(/Unsupported lume-cms compiled content schema/);
    expect(() => createFumadocsSource({ schemaVersion: 2, entries: [] } as never))
      .toThrow(/Unsupported lume-cms compiled content schema/);
  });

  it('combines hide reasons with AND and falls back to slug ordering', async () => {
    const first = definePlugin({
      id: 'first',
      runtime: { resolve: (_entry: ResolvedEntry, _context: RuntimeContext, next: Next<void>) => next() },
    });
    const second = definePlugin({
      id: 'second',
      runtime: {
        resolve(entry: ResolvedEntry, _context: RuntimeContext, next: Next<void>) {
          next();
          if (entry.compiled.slug[0] === 'hidden') entry.hide('second');
        },
      },
    });
    const entries = ['z', 'hidden', 'a'].map((id) => ({
      slug: [id], path: `${id}.md`, draft: false, data: { title: id }, ext: {}, body,
    }));
    const source = createFumadocsSource(content(['first', 'second'], entries), { collections: { default: { plugins: [first, second] } } });
    expect((await source.getSource()).getPages().map((page) => page.slugs[0])).toEqual(['a', 'z']);
  });

  it('adds schedule page data only when its plugin is registered', async () => {
    const scheduled = schedule();
    const source = createFumadocsSource(content(['schedule'], [{
      slug: ['page'], path: 'page.md', draft: false, data: { title: 'Page' },
      ext: { schedule: { publishDate: null, publishAtMs: null } }, body,
    }]), { collections: { default: { plugins: [scheduled] } } });
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
        blog: { baseUrl: '/blog', plugins: ['schedule'], entries: [{
          slug: ['post'], path: 'post.md', draft: false, data: { title: 'Post' },
          ext: { schedule: { publishDate: null, publishAtMs: null } }, body,
        }], metas: [] },
        docs: { baseUrl: '/docs', plugins: [], entries: [{
          slug: ['page'], path: 'page.md', draft: false, data: { title: 'Page' }, ext: {}, body,
        }], metas: [] },
      },
    }, {
      collections: {
        blog: collection({ plugins: [schedule()] }),
        docs: collection({ plugins: [] }),
      },
    }).sources;
    const blog = (await sources.blog.getSource()).getPages()[0]!;
    const docs = (await sources.docs.getSource()).getPages()[0]!;
    expectTypeOf(blog.data.publishDate).toEqualTypeOf<string | null>();
    expect(blog.data.publishDate).toBeNull();
    expect(docs.data).not.toHaveProperty('publishDate');
  });

  it('makes schedule ordering opt-in so meta and slug order remain authoritative by default', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(30);
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
      collections: { default: { plugins: [schedule()] } },
    });
    expect((await normal.getSource()).getPages().map((page) => page.slugs[0])).toEqual(['a', 'z']);

    const blog = createFumadocsSource(content(['schedule'], entries), {
      collections: { default: { plugins: [schedule({ sort: 'date-desc' })] } },
    });
    expect((await blog.getSource()).getPages().map((page) => page.slugs[0])).toEqual(['z', 'a']);
  });
});
