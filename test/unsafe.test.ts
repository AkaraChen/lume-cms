import { describe, expect, it } from 'vitest';
import { createContentSource } from '../src/source.js';
import type { CompiledContent } from '../src/types.js';
import { unsafe_getAllEntriesIncludingUnpublished } from '../src/unsafe.js';

describe('unsafe_getAllEntriesIncludingUnpublished', () => {
  it('returns a detached deeply frozen snapshot that cannot mutate the live source', () => {
    const content: CompiledContent = {
      schemaVersion: 1,
      entries: [{
        id: 'page', slug: ['page'], sourcePath: 'content/page.md', publishDate: null,
        publishAtMs: null, draft: false, data: { title: 'Original' },
        body: { format: 'markdown', markdown: 'body', html: '<p>body</p>', toc: [] },
      }],
    };
    const source = createContentSource(content, { now: () => new Date(0) });
    const snapshot = unsafe_getAllEntriesIncludingUnpublished(content);

    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot[0]?.data)).toBe(true);
    expect(() => (snapshot as typeof content.entries).push(content.entries[0]!)).toThrow();
    expect(() => { snapshot[0]!.data.title = 'Mutated'; }).toThrow();
    expect(source.getEntry('page')?.data.title).toBe('Original');
  });
});
