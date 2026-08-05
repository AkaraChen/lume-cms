import { run } from '@mdx-js/mdx';
import type { DynamicSource, MetaData } from 'fumadocs-core/source';
import { createElement, type ComponentType } from 'react';
import * as runtime from 'react/jsx-runtime';
import type { CompiledBody, CompiledContent, CompiledEntry, PublicEntry } from './types.js';

/** The only visibility predicate in the package. Every read path derives from it. */
function isVisible(entry: CompiledEntry, nowMs: number): boolean {
  return !entry.draft && (entry.publishAtMs === null || entry.publishAtMs <= nowMs);
}

type BodyComponent = ComponentType<{ components?: Record<string, unknown> }>;

/** Evaluate trusted, build-produced MDX lazily, once per entry. */
function bodyComponent(body: CompiledBody): BodyComponent {
  let evaluated: Promise<BodyComponent> | undefined;
  return async function CompiledBodyContent(props) {
    evaluated ??= run(body.code, { ...runtime, baseUrl: import.meta.url }).then(
      (module) => module.default as BodyComponent,
    );
    return createElement(await evaluated, props);
  };
}

/** Page data handed to Fumadocs, mirroring what `fumadocs-mdx` provides. */
export type PageData<Data extends Record<string, unknown> = Record<string, unknown>> = Data & {
  title: string;
  body: BodyComponent;
  content: string;
  toc: CompiledBody['toc'];
  structuredData: CompiledBody['structuredData'];
  publishDate: string | null;
};

export interface ContentSourceOptions {
  now?: () => Date;
}

export interface ContentSource<Data extends Record<string, unknown> = Record<string, unknown>> {
  getEntry(slug: string | string[]): PublicEntry<Data> | undefined;
  getEntries(): PublicEntry<Data>[];
  generateParams(): Array<{ slug: string[] }>;
  nextTransitionAt(): number | null;
  toDynamicSource(): DynamicSource<{ pageData: PageData<Data>; metaData: MetaData }>;
}

function toPublic<Data extends Record<string, unknown>>({
  publishAtMs: _publishAtMs,
  draft: _draft,
  ...entry
}: CompiledEntry<Data>): PublicEntry<Data> {
  return { ...entry, slug: [...entry.slug], data: { ...entry.data }, body: { ...entry.body } };
}

export function createContentSource<Data extends Record<string, unknown>>(
  content: CompiledContent<Data>,
  options: ContentSourceOptions = {},
): ContentSource<Data> {
  if (content.schemaVersion !== 1 || !Array.isArray(content.entries)) {
    throw new TypeError('Unsupported lume-cms compiled content schema');
  }

  const now = options.now ?? (() => new Date());
  function nowMs() {
    const value = now().getTime();
    if (!Number.isFinite(value)) throw new TypeError('The injected clock returned an invalid Date');
    return value;
  }

  function getEntries() {
    const at = nowMs();
    return content.entries
      .filter((entry) => isVisible(entry, at))
      .sort((a, b) => (b.publishAtMs ?? -Infinity) - (a.publishAtMs ?? -Infinity) || a.id.localeCompare(b.id))
      .map(toPublic);
  }

  return {
    getEntries,
    getEntry(slug) {
      const id = (Array.isArray(slug) ? slug : slug.split('/')).filter(Boolean).join('/') || 'index';
      return getEntries().find((entry) => entry.id === id);
    },
    generateParams() {
      return getEntries().map((entry) => ({ slug: entry.slug }));
    },
    nextTransitionAt() {
      const at = nowMs();
      const upcoming = content.entries
        .filter((entry) => !entry.draft && entry.publishAtMs !== null && entry.publishAtMs > at)
        .map((entry) => entry.publishAtMs as number);
      return upcoming.length ? Math.min(...upcoming) : null;
    },
    toDynamicSource: () => ({
      files: () => [
        ...getEntries().map((entry) => ({
          type: 'page' as const,
          path: entry.path,
          slugs: entry.slug,
          data: {
            ...entry.data,
            title: typeof entry.data.title === 'string' ? entry.data.title : entry.id,
            body: bodyComponent(entry.body),
            content: entry.body.markdown,
            toc: entry.body.toc,
            structuredData: entry.body.structuredData,
            publishDate: entry.publishDate,
          } as PageData<Data>,
        })),
        ...(content.metas ?? []).map((meta) => ({
          type: 'meta' as const,
          path: meta.path,
          data: { ...meta.data },
        })),
      ],
    }),
  };
}
