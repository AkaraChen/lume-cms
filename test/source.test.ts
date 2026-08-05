import { describe, expect, it } from 'vitest';
import { createContentSource } from '../src/source.js';
import type { CompiledContent, CompiledEntry } from '../src/types.js';

function entry(id: string, publishAtMs: number | null, draft = false): CompiledEntry {
  return {
    id,
    slug: id.split('/'),
    sourcePath: `content/${id}.md`,
    publishDate: publishAtMs === null ? null : new Date(publishAtMs).toISOString(),
    publishAtMs,
    draft,
    data: { title: id, secret: `secret-${id}` },
    body: { format: 'markdown', markdown: id, html: `<p>${id}</p>`, toc: [] },
  };
}

function content(entries: CompiledEntry[]): CompiledContent {
  return { schemaVersion: 1, entries };
}

describe('createContentSource', () => {
  it('treats the publish instant as visible and one millisecond before as hidden', () => {
    let now = 999;
    const source = createContentSource(content([entry('future', 1_000)]), { now: () => new Date(now) });
    expect(source.getEntry('future')).toBeUndefined();
    now = 1_000;
    expect(source.getEntry('future')?.id).toBe('future');
  });

  it('makes missing publishDate immediately visible and drafts permanently hidden', () => {
    const source = createContentSource(content([entry('plain', null), entry('draft', null, true)]), {
      now: () => new Date(0),
    });
    expect(source.getEntries().map((item) => item.id)).toEqual(['plain']);
  });

  it('filters every public read path before deriving results', async () => {
    const source = createContentSource(content([entry('public', 1), entry('hidden/nested', 3)]), {
      now: () => new Date(2),
    });
    expect(source.getEntry('hidden/nested')).toBeUndefined();
    expect(source.getEntries().map((item) => item.id)).toEqual(['public']);
    expect(JSON.stringify(source.getNavigationTree())).not.toContain('hidden');
    expect(source.generateParams()).toEqual([{ slug: ['public'] }]);
    expect(JSON.stringify(await source.toDynamicSource().files())).not.toContain('hidden');
  });

  it('reports only the next non-draft transition', () => {
    const source = createContentSource(content([entry('a', 50), entry('b', 30), entry('draft', 20, true)]), {
      now: () => new Date(10),
    });
    expect(source.nextTransitionAt()).toBe(30);
  });

  it('does not expose the compiled container through returned entries', () => {
    const compiled = entry('page', null);
    const source = createContentSource(content([compiled]), { now: () => new Date(0) });
    const visible = source.getEntry('page')!;
    visible.data.title = 'changed';
    expect(compiled.data.title).toBe('page');
    expect(visible).not.toHaveProperty('draft');
    expect(visible).not.toHaveProperty('publishAtMs');
  });
});
