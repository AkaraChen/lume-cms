import 'server-only';

import { run } from '@mdx-js/mdx';
import { dynamicLoader } from 'fumadocs-core/source/dynamic';
import type { DynamicSource, LoaderPluginOption, MetaData } from 'fumadocs-core/source';
import { createElement, type ComponentType } from 'react';
import * as runtime from 'react/jsx-runtime';
import type { CompiledBody, CompiledContent, CompiledEntry } from './types.js';

type BodyComponent = ComponentType<{ components?: Record<string, unknown> }>;

export type { CompiledContent } from './types.js';

interface FumadocsSourceOptions {
  baseUrl?: string;
  now?: () => Date;
  plugins?: LoaderPluginOption[];
}

type LumePageData<Data extends Record<string, unknown> = Record<string, unknown>> = Data & {
  title: string;
  body: BodyComponent;
  content: string;
  toc: CompiledBody['toc'];
  structuredData: CompiledBody['structuredData'];
  publishDate: string | null;
};

/** The single visibility boundary. Every Fumadocs read path derives from its files. */
function isVisible(entry: CompiledEntry, nowMs: number): boolean {
  return !entry.draft && (entry.publishAtMs === null || entry.publishAtMs <= nowMs);
}

function bodyComponent(body: CompiledBody): BodyComponent {
  let evaluated: Promise<BodyComponent> | undefined;
  return async function CompiledBodyContent(props) {
    evaluated ??= run(body.code, { ...runtime, baseUrl: import.meta.url }).then(
      (module) => module.default as BodyComponent,
    );
    return createElement(await evaluated, props);
  };
}

export function createFumadocsSource<Data extends Record<string, unknown>>(
  content: CompiledContent<Data>,
  options: FumadocsSourceOptions = {},
) {
  if (content.schemaVersion !== 1 || !Array.isArray(content.entries)) {
    throw new TypeError('Unsupported lume-cms compiled content schema');
  }

  const now = options.now ?? (() => new Date());
  function currentTime() {
    const value = now().getTime();
    if (!Number.isFinite(value)) throw new TypeError('The injected clock returned an invalid Date');
    return value;
  }

  const source: DynamicSource<{ pageData: LumePageData<Data>; metaData: MetaData }> = {
    files: () => {
      const at = currentTime();
      return [
        ...content.entries
          .filter((entry) => isVisible(entry, at))
          .sort((a, b) => (b.publishAtMs ?? -Infinity) - (a.publishAtMs ?? -Infinity)
            || a.slug.join('/').localeCompare(b.slug.join('/')))
          .map((entry) => ({
            type: 'page' as const,
            path: entry.path,
            slugs: entry.slug,
            data: {
              ...entry.data,
              title: typeof entry.data.title === 'string' ? entry.data.title : entry.slug.join('/') || 'index',
              body: bodyComponent(entry.body),
              content: entry.body.markdown,
              toc: entry.body.toc,
              structuredData: entry.body.structuredData,
              publishDate: entry.publishDate,
            } as LumePageData<Data>,
          })),
      ];
    },
  };
  const loader = dynamicLoader(source, {
    baseUrl: options.baseUrl ?? '/',
    plugins: options.plugins,
  });
  let validUntil = -Infinity;
  let refreshPromise: ReturnType<typeof loader.get> | undefined;

  async function getSource() {
    while (true) {
      const nowMs = currentTime();
      if (nowMs < validUntil) return loader.get();

      const active = refreshPromise ??= refresh();
      try {
        const source = await active;
        if (currentTime() < validUntil) return source;
      } finally {
        if (refreshPromise === active) refreshPromise = undefined;
      }
    }
  }

  async function refresh() {
    loader.invalidate();
    const source = await loader.get();
    const refreshedAt = currentTime();
    validUntil = content.entries
      .filter((entry) => !entry.draft && entry.publishAtMs !== null && entry.publishAtMs > refreshedAt)
      .reduce((next, entry) => Math.min(next, entry.publishAtMs as number), Infinity);
    return source;
  }

  return { getSource };
}
