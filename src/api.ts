/* eslint-disable n/no-unsupported-features/node-builtins -- Web-standard APIs are the cross-runtime contract. */
import { Hono, type Context } from 'hono';
import type { I18nConfig } from 'fumadocs-core/i18n';
import type { Root } from 'fumadocs-core/page-tree';
import type { AnyLumePlugin, PreviewOptions } from './plugin.js';
import type { CompiledCollection } from './types.js';
import type { CollectionRuntimeMeta, FumadocsCollectionFactory } from './index.js';

type ApiFactory = FumadocsCollectionFactory<
  CompiledCollection,
  readonly AnyLumePlugin[],
  I18nConfig | undefined
>;
type ApiSource = Awaited<ReturnType<ApiFactory['getSource']>>;
type ApiPage = ReturnType<ApiSource['getPages']>[number];

export interface LumeApiOptions {
  /** Factories returned by createFumadocsSources(). */
  sources: Record<string, ApiFactory>;
  /** Route prefix used when this Hono app handles the request directly. */
  basePath?: string;
  preview?: {
    enabled: boolean;
    authorize?: (context: Context) => boolean | Promise<boolean>;
  };
  cache?: {
    mode?: 'deadline' | 'no-store';
    maxAgeCapSeconds?: number;
  };
}

interface PageRepresentation {
  collection: string;
  url: string;
  slugs: string[];
  locale?: string;
  path: string;
  data: Record<string, unknown>;
  content?: string;
  processedMarkdown?: string;
  toc?: unknown;
  structuredData?: unknown;
}

interface LoadedCollection {
  name: string;
  source: ApiSource;
  meta?: CollectionRuntimeMeta;
}

interface PreviewRequest {
  active: boolean;
  options: PreviewOptions;
}

const defaultLimit = 50;
const maxLimit = 200;
const defaultMaxAgeCapSeconds = 3600;

function normalizeBasePath(value: string | undefined) {
  if (!value || value === '/') return '/';
  return `/${value.split('/').filter(Boolean).join('/')}`;
}

function previewRequest(url: URL, isEnabled: boolean): PreviewRequest {
  if (!isEnabled) return { active: false, options: {} };
  const preview = url.searchParams.get('preview');
  const reveal = url.searchParams.get('reveal');
  if (preview === null && reveal === null) return { active: false, options: {} };
  const values = new Set([
    ...(preview?.split(',') ?? []),
    ...(reveal?.split(',') ?? []),
  ].map((value) => value.trim()).filter(Boolean));
  return {
    active: true,
    options: {
      draft: values.delete('draft'),
      future: values.delete('future'),
      ...(values.size > 0 && { reveal: [...values] }),
    },
  };
}

function jsonSafe<Value>(value: Value): Value {
  // JSON projection intentionally omits non-serializable React/plugin values.
  // eslint-disable-next-line unicorn/prefer-structured-clone
  return JSON.parse(JSON.stringify(value)) as Value;
}

function pageRepresentation(collection: string, page: ApiPage, isFull: boolean): PageRepresentation {
  const {
    body: _body,
    content,
    processedMarkdown,
    toc,
    structuredData,
    ...data
  } = page.data;
  return jsonSafe({
    collection,
    url: page.url,
    slugs: page.slugs,
    ...(page.locale && { locale: page.locale }),
    path: page.path,
    data,
    ...(isFull && { content, processedMarkdown, toc, structuredData }),
  });
}

function pageKey(page: PageRepresentation) {
  return `${page.collection}\0${page.locale ?? ''}\0${page.slugs.join('/')}`;
}

function encodeCursor(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCodePoint(byte);
  // eslint-disable-next-line unicorn/prefer-uint8array-base64
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/[=]+$/u, '');
}

function decodeCursor(value: string) {
  try {
    const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
    // eslint-disable-next-line unicorn/prefer-uint8array-base64
    const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='));
    return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.codePointAt(0) ?? 0));
  } catch {
    return undefined;
  }
}

function parseLimit(value: string | null) {
  if (value === null) return defaultLimit;
  if (!/^\d+$/u.test(value)) return undefined;
  const limit = Number(value);
  return limit >= 1 && limit <= maxLimit ? limit : undefined;
}

async function etag(body: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
  const bytes = new Uint8Array(digest);
  return `"${[...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')}"`;
}

async function response(
  context: Context,
  payload: unknown,
  collections: readonly LoadedCollection[],
  isPreview: boolean,
  cache: NonNullable<LumeApiOptions['cache']>,
) {
  const body = JSON.stringify(payload);
  const tag = await etag(body);
  const headers = new Headers({
    'content-type': 'application/json; charset=UTF-8',
    etag: tag,
  });
  if (isPreview || cache.mode === 'no-store') {
    headers.set('cache-control', isPreview ? 'private, no-store' : 'no-store');
  } else {
    const until = Math.min(...collections.map((collection) => collection.meta?.until ?? Infinity));
    const cap = cache.maxAgeCapSeconds ?? defaultMaxAgeCapSeconds;
    const deadlineSeconds = Number.isFinite(until) ? Math.max(0, Math.floor((until - Date.now()) / 1000)) : cap;
    headers.set('cache-control', `public, max-age=${Math.min(cap, deadlineSeconds)}, must-revalidate`);
  }
  if (context.req.header('if-none-match') === tag) return new Response(null, { status: 304, headers });
  return new Response(body, { status: 200, headers });
}

function error(context: Context, status: 400 | 403 | 404 | 405 | 500, code: string, message: string) {
  return context.json({ error: { code, message } }, status, { 'cache-control': 'no-store' });
}

function collectMetas(source: ApiSource, tree: Root, locale: string | undefined) {
  const result = new Map<string, unknown>();
  function visit(node: Root | Root['children'][number]) {
    if (node.type !== 'folder' && node.type !== 'root') return;
    const meta = source.getNodeMeta(node, locale);
    if (meta) result.set(meta.path, { path: meta.path, data: meta.data });
    for (const child of node.children) visit(child);
  }
  visit(tree);
  // eslint-disable-next-line unicorn/prefer-iterator-to-array
  return [...result.values()];
}

/** Create a read-only, Web Request/Response compatible Hono content API. */
export function createLumeApi(options: LumeApiOptions): Hono {
  const app = new Hono().basePath(normalizeBasePath(options.basePath));
  const names = Object.keys(options.sources).toSorted();
  const cache = { mode: 'deadline' as const, ...options.cache };

  async function load(context: Context, requestedNames: readonly string[]) {
    const request = previewRequest(new URL(context.req.url), options.preview?.enabled === true);
    if (request.active && (!options.preview?.authorize || !await options.preview.authorize(context))) {
      return { denied: true as const, request, collections: [] };
    }
    const collections = await Promise.all(requestedNames.map(async (name): Promise<LoadedCollection> => {
      const factory = options.sources[name];
      if (!request.active) {
        const snapshot = await factory.getSnapshot();
        return { name, ...snapshot };
      }
      return {
        name,
        source: await factory.getPreviewSource(request.options),
        meta: await factory.getMeta(),
      };
    }));
    return { denied: false as const, request, collections };
  }

  async function listPages(context: Context, selected: readonly string[]) {
    const limit = parseLimit(context.req.query('limit') ?? null);
    if (limit === undefined) return error(context, 400, 'invalid_query', `limit must be between 1 and ${maxLimit}`);
    const fields = context.req.query('fields') ?? 'summary';
    if (fields !== 'summary' && fields !== 'full') {
      return error(context, 400, 'invalid_query', 'fields must be summary or full');
    }
    const cursorValue = context.req.query('cursor');
    const cursor = cursorValue ? decodeCursor(cursorValue) : undefined;
    if (cursorValue && cursor === undefined) return error(context, 400, 'invalid_query', 'cursor is invalid');
    const loaded = await load(context, selected);
    if (loaded.denied) return error(context, 403, 'preview_forbidden', 'Preview access is forbidden');
    const locale = context.req.query('locale');
    const tag = context.req.query('tag');
    const pages = loaded.collections
      .flatMap(({ name, source }) => source.getPages(locale).map((page) => pageRepresentation(name, page, fields === 'full')))
      .filter((page) => !tag || Array.isArray(page.data.tags) && page.data.tags.includes(tag))
      .toSorted((left, right) => pageKey(left).localeCompare(pageKey(right)));
    const remaining = cursor ? pages.filter((page) => pageKey(page) > cursor) : pages;
    const data = remaining.slice(0, limit);
    const last = data.at(-1);
    const nextCursor = remaining.length > limit && last
      ? encodeCursor(pageKey(last))
      : null;
    return response(context, { data, pagination: { nextCursor, limit } }, loaded.collections, loaded.request.active, cache);
  }

  app.get('/collections', async (context) => {
    const loaded = await load(context, names);
    if (loaded.denied) return error(context, 403, 'preview_forbidden', 'Preview access is forbidden');
    const payload = loaded.collections.map(({ name, source, meta }) => ({
      name,
      baseUrl: meta?.baseUrl ?? '',
      ...(meta?.i18n && { i18n: meta.i18n }),
      pageCount: source.getPages().length,
    }));
    return response(context, payload, loaded.collections, loaded.request.active, cache);
  });

  app.get('/pages', async (context) => {
    const selected = context.req.query('collection')?.split(',').filter(Boolean) ?? names;
    if (selected.some((name) => !names.includes(name))) {
      return error(context, 404, 'collection_not_found', 'One or more collections were not found');
    }
    return listPages(context, selected);
  });

  app.get('/collections/:collection/pages', async (context) => {
    const name = context.req.param('collection');
    if (!names.includes(name)) return error(context, 404, 'collection_not_found', `Collection ${JSON.stringify(name)} was not found`);
    return listPages(context, [name]);
  });

  app.get('/collections/:collection/tree', async (context) => {
    const name = context.req.param('collection');
    if (!names.includes(name)) return error(context, 404, 'collection_not_found', `Collection ${JSON.stringify(name)} was not found`);
    const loaded = await load(context, [name]);
    if (loaded.denied) return error(context, 403, 'preview_forbidden', 'Preview access is forbidden');
    const locale = context.req.query('locale');
    const tree = loaded.collections[0].source.getPageTree(locale);
    const payload = await loaded.collections[0].source.serializePageTree(tree);
    return response(context, payload, loaded.collections, loaded.request.active, cache);
  });

  app.get('/collections/:collection/meta', async (context) => {
    const name = context.req.param('collection');
    if (!names.includes(name)) return error(context, 404, 'collection_not_found', `Collection ${JSON.stringify(name)} was not found`);
    const loaded = await load(context, [name]);
    if (loaded.denied) return error(context, 403, 'preview_forbidden', 'Preview access is forbidden');
    const locale = context.req.query('locale');
    const source = loaded.collections[0].source;
    const payload = collectMetas(source, source.getPageTree(locale), locale);
    return response(context, payload, loaded.collections, loaded.request.active, cache);
  });

  app.get('/collections/:collection/pages/:slug{.*}', async (context) => {
    const name = context.req.param('collection');
    if (!names.includes(name)) return error(context, 404, 'collection_not_found', `Collection ${JSON.stringify(name)} was not found`);
    const loaded = await load(context, [name]);
    if (loaded.denied) return error(context, 403, 'preview_forbidden', 'Preview access is forbidden');
    const slugParameter = context.req.param('slug');
    const slug = slugParameter === '_index' ? [] : slugParameter.split('/').filter(Boolean);
    const page = loaded.collections[0].source.getPage(slug, context.req.query('locale'));
    if (!page) return error(context, 404, 'page_not_found', 'Page was not found');
    return response(
      context,
      pageRepresentation(name, page, true),
      loaded.collections,
      loaded.request.active,
      cache,
    );
  });

  app.on(['POST', 'PUT', 'PATCH', 'DELETE'], '*', (context) => (
    error(context, 405, 'method_not_allowed', 'The content API is read-only')
  ));

  return app;
}

export function toNextHandler(api: Pick<Hono, 'fetch'>) {
  const handler = async (request: Request) => api.fetch(request);
  return { GET: handler, HEAD: handler };
}

export function toStartHandler(api: Pick<Hono, 'fetch'>) {
  const handler = async ({ request }: { request: Request }) => api.fetch(request);
  return { GET: handler, HEAD: handler };
}
