import 'server-only';

import { run } from '@mdx-js/mdx';
import { dynamicLoader } from 'fumadocs-core/source/dynamic';
import * as runtime from 'react/jsx-runtime';
import type { ComponentType } from 'react';
import { createContentSource, type ContentSourceOptions } from './source.js';
import type { CompiledBody, CompiledContent } from './types.js';

export interface FumadocsSourceOptions extends ContentSourceOptions {
  baseUrl?: string;
  maxStaleMs?: number;
}

/** Evaluate trusted, build-produced MDX on the server and return its React component. */
export async function getMdxComponent(
  body: CompiledBody,
): Promise<ComponentType<{ components?: Record<string, ComponentType<any>> }>> {
  if (body.format !== 'mdx' || !body.code) {
    throw new TypeError('getMdxComponent() requires a compiled MDX body');
  }
  const module = await run(body.code, { ...runtime, baseUrl: import.meta.url });
  return module.default as ComponentType<{ components?: Record<string, ComponentType<any>> }>;
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
