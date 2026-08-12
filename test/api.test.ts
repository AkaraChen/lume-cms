import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLumeApi, toNextHandler, toStartHandler } from '../src/api.js';
import { defineI18n } from '../src/config.js';
import { collection, createFumadocsSources } from '../src/index.js';
import { schedule } from '../src/schedule.js';
import type { CompiledContent, CompiledEntry } from '../src/types.js';

const body = (value: string) => ({
  markdown: `${value} source`,
  processedMarkdown: `${value} processed`,
  code: '',
  toc: [{ title: value, url: `#${value}`, depth: 2 }],
  structuredData: { headings: [], contents: [] },
});

function entry(id: string, publishAtMs: number | null = null, draft = false): CompiledEntry {
  return {
    slug: [id],
    path: `${id}.mdx`,
    draft,
    data: { title: id, description: `${id} description`, tags: [id] },
    ext: { schedule: { publishDate: publishAtMs === null ? null : new Date(publishAtMs).toISOString(), publishAtMs } },
    body: body(id),
  };
}

function fixtures() {
  const content: CompiledContent = {
    schemaVersion: 3,
    collections: {
      docs: {
        baseUrl: '/docs',
        plugins: ['schedule'],
        entries: [entry('a'), entry('future', 20)],
        metas: [{ path: 'meta.json', data: { title: 'Docs', pages: ['a', 'future'] } }],
      },
      blog: {
        baseUrl: '/blog',
        plugins: ['schedule'],
        entries: [entry('b'), entry('draft', null, true)],
        metas: [],
      },
    },
  };
  const result = createFumadocsSources(content, {
    collections: {
      docs: collection({ plugins: [schedule()] }),
      blog: collection({ plugins: [schedule()] }),
    },
  });
  return { ...result, api: createLumeApi({ sources: result.sources }) };
}

async function json(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

describe('createLumeApi', () => {
  afterEach(() => vi.useRealTimers());

  it('lists multiple collections and exposes their runtime metadata', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10);
    const { api, sources } = fixtures();
    await expect(sources.docs.getMeta()).resolves.toEqual({ baseUrl: '/docs', until: 20 });
    const snapshot = await sources.docs.getSnapshot();
    vi.setSystemTime(20);
    expect(snapshot.source.getPages().map((page) => page.url)).toEqual(['/docs/a']);
    expect(snapshot.meta.until).toBe(20);
    vi.setSystemTime(10);
    const response = await api.request('/collections');
    expect(await response.json()).toEqual([
      { name: 'blog', baseUrl: '/blog', pageCount: 1 },
      { name: 'docs', baseUrl: '/docs', pageCount: 1 },
    ]);
    expect(response.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate');
  });

  it('paginates deterministic summaries without gaps or duplicates', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10);
    const { api } = fixtures();
    const first = await api.request('/pages?limit=1');
    const firstBody = await json(first) as { data: Array<Record<string, unknown>>; pagination: { nextCursor: string } };
    expect(firstBody.data).toHaveLength(1);
    expect(firstBody.data[0]).not.toHaveProperty('content');
    const second = await api.request(`/pages?limit=1&cursor=${encodeURIComponent(firstBody.pagination.nextCursor)}`);
    const secondBody = await json(second) as { data: Array<Record<string, unknown>> };
    expect([...firstBody.data, ...secondBody.data].map((page) => page.url)).toEqual(['/blog/b', '/docs/a']);
  });

  it('uses one request-time visibility source for list, detail, and tree', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(19);
    const { api } = fixtures();
    expect((await json(await api.request('/collections/docs/pages'))).data).toHaveLength(1);
    expect((await api.request('/collections/docs/pages/future')).status).toBe(404);
    expect(JSON.stringify(await (await api.request('/collections/docs/tree')).json())).not.toContain('/docs/future');

    vi.setSystemTime(20);
    expect((await json(await api.request('/collections/docs/pages'))).data).toHaveLength(2);
    expect((await api.request('/collections/docs/pages/future')).status).toBe(200);
    expect(JSON.stringify(await (await api.request('/collections/docs/tree')).json())).toContain('/docs/future');
  });

  it('returns serializable full pages without React body and supports stable ETags', async () => {
    const { api } = fixtures();
    const first = await api.request('/collections/docs/pages/a');
    const payload = await first.json() as Record<string, unknown>;
    expect(payload).toMatchObject({ content: 'a source', processedMarkdown: 'a processed' });
    expect(JSON.stringify(payload)).not.toContain('"body"');
    const second = await api.request('/collections/docs/pages/a', {
      headers: { 'if-none-match': first.headers.get('etag')! },
    });
    expect(second.status).toBe(304);
    expect(await second.text()).toBe('');
  });

  it('serves the empty-slug root page through the reserved _index detail path', async () => {
    const result = createFumadocsSources({
      schemaVersion: 3,
      collections: { docs: {
        baseUrl: '/docs',
        plugins: [],
        entries: [{ ...entry('root'), slug: [], path: 'index.mdx' }],
        metas: [],
      } },
    }, { collections: { docs: collection({}) } });
    const api = createLumeApi({ sources: result.sources });

    const canonical = await api.request('/collections/docs/pages/_index');
    expect(canonical.status).toBe(200);
    expect(await canonical.json()).toMatchObject({ url: '/docs', slugs: [], content: 'root source' });
    expect((await api.request('/collections/docs/pages/')).status).toBe(200);
  });

  it('guards previews and never gives them public cache headers', async () => {
    const result = fixtures();
    const disabled = createLumeApi({ sources: result.sources, preview: { enabled: false } });
    expect((await json(await disabled.request('/collections/blog/pages?preview=draft'))).data).toHaveLength(1);

    const denied = createLumeApi({
      sources: result.sources,
      preview: { enabled: true, authorize: () => false },
    });
    expect((await denied.request('/collections/blog/pages?preview=draft')).status).toBe(403);

    const missingAuthorization = createLumeApi({
      sources: result.sources,
      preview: { enabled: true },
    });
    expect((await missingAuthorization.request('/collections/blog/pages?preview=draft')).status).toBe(403);

    const allowed = createLumeApi({
      sources: result.sources,
      preview: { enabled: true, authorize: () => true },
    });
    const response = await allowed.request('/collections/blog/pages?preview=draft');
    expect((await json(response)).data).toHaveLength(2);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('reports API errors, filters tags, and rejects mutations', async () => {
    const { api } = fixtures();
    expect((await api.request('/collections/missing/pages')).status).toBe(404);
    expect((await api.request('/collections/docs/pages/missing')).status).toBe(404);
    expect((await api.request('/pages?limit=0')).status).toBe(400);
    expect((await json(await api.request('/pages?tag=a'))).data).toHaveLength(1);
    expect((await api.request('/pages', { method: 'POST' })).status).toBe(405);
  });

  it('mounts below another Hono app and provides Next and Start adapters', async () => {
    const { api } = fixtures();
    const parent = new Hono().route('/x', api);
    expect((await parent.request('/x/collections')).status).toBe(200);

    const next = toNextHandler(parent);
    expect((await next.GET(new Request('https://example.test/x/collections'))).status).toBe(200);
    const start = toStartHandler(parent);
    expect((await start.GET({ request: new Request('https://example.test/x/collections') })).status).toBe(200);

    const prefixed = createLumeApi({ sources: fixtures().sources, basePath: '/api/content' });
    expect((await prefixed.request('/api/content/collections')).status).toBe(200);
    expect((await prefixed.request('/collections')).status).toBe(404);
  });

  it('passes locale selection through Fumadocs i18n fallback behavior', async () => {
    const i18n = defineI18n({ languages: ['en', 'zh'], defaultLanguage: 'en', parser: 'dot' });
    const localized = (id: string, locale: string): CompiledEntry => ({ ...entry(id), locale });
    const result = createFumadocsSources({
      schemaVersion: 3,
      collections: { docs: {
        baseUrl: '/docs',
        i18n: {
          languages: ['en', 'zh'],
          defaultLanguage: 'en',
          parser: 'dot',
          fallbackLanguage: 'en',
          hideLocale: 'never',
        },
        plugins: [],
        entries: [localized('guide', 'en'), { ...localized('guide', 'zh'), data: { title: '指南' } }],
        metas: [],
      } },
    }, { collections: { docs: collection({ i18n }) } });
    const api = createLumeApi({ sources: result.sources });
    const payload = await json(await api.request('/collections/docs/pages?locale=zh'));
    expect(payload.data).toMatchObject([{ locale: 'zh', data: { title: '指南' } }]);
  });
});
