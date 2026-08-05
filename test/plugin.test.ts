import { describe, expect, expectTypeOf, it } from 'vitest';
import { createFumadocsSource } from '../src/fumadocs.js';
import { definePlugin } from '../src/plugin.js';
import { schedule } from '../src/schedule.js';
import type { CompiledContent, CompiledEntry } from '../src/types.js';

const body = { markdown: '', code: '', toc: [], structuredData: { headings: [], contents: [] } };

function content(plugins: string[] = [], entries: CompiledEntry[] = []): CompiledContent {
  return { schemaVersion: 2, plugins, entries };
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

  it('rejects legacy v1 content with a migration message', () => {
    expect(() => createFumadocsSource({ schemaVersion: 1, entries: [] } as never))
      .toThrow(/schema version 1; rebuild content/);
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
});
