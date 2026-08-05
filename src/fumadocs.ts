import 'server-only';

import { dynamicLoader } from 'fumadocs-core/source/dynamic';
import type { LoaderPluginOption } from 'fumadocs-core/source';
import { createContentSource, type ContentSourceOptions } from './source.js';
import { evaluateCompiledBody } from './mdx-runtime.js';
import type { CompiledBody, CompiledContent } from './types.js';

export interface FumadocsSourceOptions extends ContentSourceOptions {
  baseUrl?: string;
  maxStaleMs?: number;
  plugins?: LoaderPluginOption[];
}

/** Evaluate trusted, build-produced MDX on the server and return its React component. */
export async function getMdxComponent(body: CompiledBody) {
  return evaluateCompiledBody(body);
}

export function createFumadocsSource<Data extends Record<string, unknown>>(
  content: CompiledContent<Data>,
  options: FumadocsSourceOptions = {},
) {
  const now = options.now ?? (() => new Date());
  const maxStaleMs = options.maxStaleMs ?? 60_000;
  if (!Number.isFinite(maxStaleMs) || maxStaleMs <= 0) {
    throw new TypeError('maxStaleMs must be a positive finite number');
  }

  const contentSource = createContentSource(content, { now });
  const loader = dynamicLoader(contentSource.toDynamicSource(), {
    baseUrl: options.baseUrl ?? '/',
    plugins: options.plugins,
  });
  let validUntil = -Infinity;
  let revision = 0;
  let refreshPromise: ReturnType<typeof loader.get> | undefined;

  async function getSource() {
    while (true) {
      const nowMs = now().getTime();
      if (nowMs < validUntil) return loader.get();

      const active = refreshPromise ??= refresh(revision);
      try {
        const source = await active;
        if (now().getTime() < validUntil) return source;
      } finally {
        if (refreshPromise === active) refreshPromise = undefined;
      }
    }
  }

  async function refresh(startRevision: number) {
    loader.invalidate();
    const source = await loader.get();
    if (revision === startRevision) {
      const refreshedAt = now().getTime();
      const transition = contentSource.nextTransitionAt() ?? Infinity;
      validUntil = Math.min(transition, refreshedAt + maxStaleMs);
    }
    return source;
  }

  return {
    getSource,
    contentSource,
    invalidate() {
      revision += 1;
      validUntil = -Infinity;
      loader.invalidate();
    },
  };
}
