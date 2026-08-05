import 'server-only';

import { dynamicLoader } from 'fumadocs-core/source/dynamic';
import { createContentSource, type ContentSourceOptions } from './source.js';
import type { CompiledContent } from './types.js';

export interface FumadocsSourceOptions extends ContentSourceOptions {
  baseUrl?: string;
  maxStaleMs?: number;
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
  });
  let validUntil = -Infinity;

  async function getSource() {
    const nowMs = now().getTime();
    if (nowMs >= validUntil) loader.invalidate();
    const source = await loader.get();
    const transition = contentSource.nextTransitionAt() ?? Infinity;
    validUntil = Math.min(transition, nowMs + maxStaleMs);
    return source;
  }

  return {
    getSource,
    contentSource,
    invalidate() {
      validUntil = -Infinity;
      loader.invalidate();
    },
  };
}
