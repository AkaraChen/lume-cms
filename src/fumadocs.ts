import 'server-only';

import { run } from '@mdx-js/mdx';
import { dynamicLoader } from 'fumadocs-core/source/dynamic';
import type { DynamicSource, LoaderPluginOption, MetaData } from 'fumadocs-core/source';
import { createElement, type ComponentType } from 'react';
import * as runtime from 'react/jsx-runtime';
import type { CompiledBody, CompiledContent, CompiledEntry } from './types.js';
import { assertPluginIds, type AnyLumePlugin, type InferPluginData } from './plugin.js';

type BodyComponent = ComponentType<{ components?: Record<string, unknown> }>;

export type { CompiledContent } from './types.js';

interface FumadocsSourceOptions<Plugins extends readonly AnyLumePlugin[]> {
  baseUrl?: string;
  now?: () => Date;
  plugins?: Plugins;
  loaderPlugins?: LoaderPluginOption[];
}

type LumePageData<Data extends Record<string, unknown> = Record<string, unknown>> = Data & {
  title: string;
  body: BodyComponent;
  content: string;
  toc: CompiledBody['toc'];
  structuredData: CompiledBody['structuredData'];
};

/** The single visibility boundary. Every Fumadocs read path derives from its files. */
function isVisible(entry: CompiledEntry, plugins: readonly AnyLumePlugin[], nowMs: number): boolean {
  return !entry.draft && plugins.every((plugin) => plugin.runtime?.visible?.(entry, { nowMs }) !== false);
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

export function createFumadocsSource<
  Data extends Record<string, unknown>,
  const Plugins extends readonly AnyLumePlugin[] = [],
>(
  content: CompiledContent<Data>,
  options: FumadocsSourceOptions<Plugins> = {},
) {
  if (content.schemaVersion === (1 as number)) {
    throw new TypeError('Unsupported lume-cms compiled content schema version 1; rebuild content with lume-cms 0.1 and register matching plugins');
  }
  if (content.schemaVersion !== 2 || !Array.isArray(content.entries) || !Array.isArray(content.plugins)) {
    throw new TypeError('Unsupported lume-cms compiled content schema');
  }
  const plugins = options.plugins ?? [];
  assertPluginIds(plugins);
  const runtimeIds = plugins.map((plugin) => plugin.id);
  if (content.plugins.length !== runtimeIds.length || content.plugins.some((id, index) => id !== runtimeIds[index])) {
    const missing = content.plugins.find((id) => !runtimeIds.includes(id));
    if (missing) {
      throw new TypeError(
        `Content was compiled with plugin ${JSON.stringify(missing)}; add it to createFumadocsSource({ plugins })`,
      );
    }
    const extra = runtimeIds.find((id) => !content.plugins.includes(id));
    if (extra) throw new TypeError(`Runtime plugin ${JSON.stringify(extra)} was not used to compile this content`);
    throw new TypeError('lume-cms plugins must be registered in the same order at compile time and runtime');
  }

  const now = options.now ?? (() => new Date());
  function currentTime() {
    const value = now().getTime();
    if (!Number.isFinite(value)) throw new TypeError('The injected clock returned an invalid Date');
    return value;
  }

  const source: DynamicSource<{
    pageData: LumePageData<Data & InferPluginData<Plugins>>;
    metaData: MetaData;
  }> = {
    files: () => {
      const at = currentTime();
      return [
        ...content.entries
          .filter((entry) => isVisible(entry, plugins, at))
          .sort((a, b) => {
            for (const plugin of plugins) {
              const result = plugin.runtime?.compare?.(a, b) ?? 0;
              if (result !== 0) return result;
            }
            return a.slug.join('/').localeCompare(b.slug.join('/'));
          })
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
              ...Object.assign({}, ...plugins.map((plugin) => plugin.runtime?.pageData?.(entry) ?? {})),
            } as LumePageData<Data & InferPluginData<Plugins>>,
          })),
      ];
    },
  };
  const loader = dynamicLoader(source, {
    baseUrl: options.baseUrl ?? '/',
    plugins: options.loaderPlugins,
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
    validUntil = plugins.reduce(
      (next, plugin) => Math.min(next, plugin.runtime?.deadline?.(content.entries, { nowMs: refreshedAt }) ?? Infinity),
      Infinity,
    );
    return source;
  }

  return { getSource };
}
