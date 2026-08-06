import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFromSource, type AdvancedIndex } from 'fumadocs-core/search/server';
import { createFumadocsSource } from '../src/index.js';
import { defineRuntimePlugin, type Next, type ResolvedEntry, type RuntimeContext } from '../src/plugin.js';
import { schedule } from '../src/schedule.js';
import type { CompiledContent, CompiledEntry } from '../src/types.js';

function entry(
  id: string,
  options: { draft?: boolean; expired?: boolean; locale?: string; publishAtMs?: number | null; tags?: string[] } = {},
): CompiledEntry {
  const publishAtMs = options.publishAtMs ?? null;
  return {
    slug: [id],
    locale: options.locale,
    path: `${id}${options.locale ? `.${options.locale}` : ''}.mdx`,
    draft: options.draft ?? false,
    data: { title: id, tags: options.tags },
    ext: {
      expiry: { expired: options.expired ?? false },
      schedule: {
        publishDate: publishAtMs === null ? null : new Date(publishAtMs).toISOString(),
        publishAtMs,
      },
    },
    body: {
      markdown: id,
      processedMarkdown: id,
      code: '',
      toc: [],
      structuredData: { headings: [], contents: [{ content: `${id} searchable body`, heading: undefined }] },
    },
  };
}

function buildIndex(page: {
  data: { description?: string; structuredData: CompiledEntry['body']['structuredData']; tags?: string[]; title: string };
  url: string;
}): AdvancedIndex {
  return {
    id: page.url,
    title: page.data.title,
    description: page.data.description,
    url: page.url,
    structuredData: page.data.structuredData,
    tag: page.data.tags,
  };
}

function urls(results: Array<{ url: string }>): string[] {
  return [...new Set(results.map((result) => result.url))];
}

describe('dynamic Fumadocs search contract', () => {
  afterEach(() => vi.useRealTimers());

  it('re-indexes at a deadline and applies tag filters after the visibility boundary', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(19);
    const expiry = defineRuntimePlugin({
      id: 'expiry',
      runtime: {
        resolve(page: ResolvedEntry, _context: RuntimeContext, next: Next<void>) {
          next();
          if ((page.compiled.ext.expiry as { expired: boolean }).expired) page.hide('expired');
        },
      },
    });
    const content = {
      schemaVersion: 3,
      collections: {
        docs: {
          baseUrl: '/',
          i18n: undefined,
          plugins: ['schedule'],
          entries: [
            entry('published', { publishAtMs: 10, tags: ['guide'] }),
            entry('scheduled', { publishAtMs: 20, tags: ['guide', 'release'] }),
            entry('draft', { draft: true, tags: ['guide'] }),
            entry('expired', { expired: true, tags: ['guide'] }),
          ],
          metas: [],
        },
      },
    } satisfies CompiledContent;
    const factory = createFumadocsSource(content, {
      collections: { docs: { plugins: [schedule(), expiry] } },
    });
    const search = createFromSource(factory.getSource, { buildIndex });

    expect(urls(await search.search('published'))).toEqual(['/published']);
    expect(await search.search('scheduled')).toEqual([]);
    expect(await search.search('draft')).toEqual([]);
    expect(await search.search('expired')).toEqual([]);

    const tagged = await search.GET(new Request('https://example.com/api/search?query=searchable&tag=release'));
    expect(await tagged.json()).toEqual([]);

    vi.setSystemTime(20);
    expect(urls(await search.search('scheduled'))).toEqual(['/scheduled']);
    const refreshed = await search.GET(new Request('https://example.com/api/search?query=searchable&tag=release'));
    expect(urls(await refreshed.json() as Array<{ url: string }>)).toEqual(['/scheduled']);
    expect(await search.search('draft')).toEqual([]);
    expect(await search.search('expired')).toEqual([]);
  });

  it('uses localeMap search servers without mixing locale indexes', async () => {
    const content = {
      schemaVersion: 3,
      collections: {
        docs: {
          baseUrl: '/docs',
          i18n: {
            languages: ['en', 'zh'],
            defaultLanguage: 'en',
            fallbackLanguage: null,
            hideLocale: 'never',
            parser: 'dot',
          },
          plugins: [],
          entries: [
            entry('english-only', { locale: 'en' }),
            entry('chinese-only', { locale: 'zh' }),
          ],
          metas: [],
        },
      },
    } satisfies CompiledContent;
    const factory = createFumadocsSource(content, { collections: { docs: {} } });
    const search = createFromSource(factory.getSource, {
      buildIndex,
      localeMap: { en: 'english', zh: 'multilingual' },
    });

    expect(urls(await search.search('english', { locale: 'en' })))
      .toEqual(['/en/docs/english-only']);
    expect(await search.search('english', { locale: 'zh' })).toEqual([]);
    expect(urls(await search.search('chinese', { locale: 'zh' })))
      .toEqual(['/zh/docs/chinese-only']);
    expect(await search.search('chinese', { locale: 'en' })).toEqual([]);
  });
});
