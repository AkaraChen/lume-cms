import { describe, expect, it } from 'vitest';
import { createFumadocsSource } from '../src/fumadocs.js';
import type { CompiledContent } from '../src/types.js';

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
});
