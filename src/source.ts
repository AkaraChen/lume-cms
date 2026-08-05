import type { DynamicSource, MetaData } from 'fumadocs-core/source';
import type { ComponentType } from 'react';
import { createCompiledBodyComponent } from './mdx-runtime.js';
import type {
  CompiledContent,
  CompiledEntry,
  NavigationNode,
  PublicEntry,
} from './types.js';
import { isVisible } from './visibility.js';

export interface ContentSourceOptions {
  now?: () => Date;
}

export interface ContentSource<Data extends Record<string, unknown> = Record<string, unknown>> {
  getEntry(slug: string | string[]): PublicEntry<Data> | undefined;
  getEntries(): PublicEntry<Data>[];
  getNavigationTree(): NavigationNode[];
  generateParams(): Array<{ slug: string[] }>;
  nextTransitionAt(): number | null;
  toDynamicSource(): DynamicSource<{
    pageData: Omit<Data, 'title' | 'description' | 'icon' | 'full' | 'body' | 'content' | 'toc' | 'structuredData' | 'publishDate'> & {
      title: string;
      description?: string;
      icon?: string;
      full?: boolean;
      body: ComponentType<{ components?: Record<string, any> }>;
      content: string;
      toc: PublicEntry<Data>['body']['toc'];
      structuredData: NonNullable<PublicEntry<Data>['body']['structuredData']>;
      publishDate: string | null;
    };
    metaData: MetaData;
  }>;
}

function toPublic<Data extends Record<string, unknown>>(
  entry: CompiledEntry<Data>,
): PublicEntry<Data> {
  return {
    id: entry.id,
    slug: [...entry.slug],
    sourcePath: entry.sourcePath,
    virtualPath: entry.virtualPath,
    publishDate: entry.publishDate,
    data: { ...entry.data },
    body: {
      ...entry.body,
      toc: entry.body.toc.map((item) => ({ ...item })),
    },
  };
}

export function createContentSource<Data extends Record<string, unknown>>(
  content: CompiledContent<Data>,
  options: ContentSourceOptions = {},
): ContentSource<Data> {
  if (content.schemaVersion !== 1 || !Array.isArray(content.entries)) {
    throw new TypeError('Unsupported lume-cms compiled content schema');
  }

  const now = options.now ?? (() => new Date());
  const visibleEntries = () => {
    const nowMs = now().getTime();
    if (!Number.isFinite(nowMs)) throw new TypeError('The injected clock returned an invalid Date');
    return content.entries
      .filter((entry) => isVisible(entry, nowMs))
      .sort((a, b) => (b.publishAtMs ?? -Infinity) - (a.publishAtMs ?? -Infinity) || a.id.localeCompare(b.id));
  };

  const getEntries = () => visibleEntries().map(toPublic);

  return {
    getEntry(slug) {
      const key = (Array.isArray(slug) ? slug : slug.split('/')).filter(Boolean).join('/');
      const entry = visibleEntries().find((candidate) => candidate.slug.join('/') === key);
      return entry ? toPublic(entry) : undefined;
    },
    getEntries,
    getNavigationTree() {
      const roots: NavigationNode[] = [];
      for (const entry of getEntries()) {
        let level = roots;
        entry.slug.forEach((segment, index) => {
          let node = level.find((candidate) => candidate.name === segment);
          if (!node) {
            node = { name: segment };
            level.push(node);
            level.sort((a, b) => a.name.localeCompare(b.name));
          }
          if (index === entry.slug.length - 1) {
            node.slug = [...entry.slug];
            node.entry = entry;
          } else {
            node.children ??= [];
            level = node.children;
          }
        });
      }
      return roots;
    },
    generateParams() {
      return getEntries().map((entry) => ({ slug: [...entry.slug] }));
    },
    nextTransitionAt() {
      const nowMs = now().getTime();
      let result = Infinity;
      for (const entry of content.entries) {
        if (!entry.draft && entry.publishAtMs !== null && entry.publishAtMs > nowMs) {
          result = Math.min(result, entry.publishAtMs);
        }
      }
      return Number.isFinite(result) ? result : null;
    },
    toDynamicSource() {
      return {
        files: () =>
          [
            ...getEntries().map((entry) => ({
              type: 'page' as const,
              path: entry.virtualPath ?? entry.sourcePath.replace(/^.*?content\//, ''),
              slugs: entry.slug,
              data: {
                ...entry.data,
                title: typeof entry.data.title === 'string' ? entry.data.title : entry.id,
                body: createCompiledBodyComponent(entry.body),
                content: entry.body.markdown,
                toc: entry.body.toc,
                structuredData: entry.body.structuredData ?? { headings: [], contents: [] },
                publishDate: entry.publishDate,
              },
            })),
            ...(content.metas ?? []).map((meta) => ({
              type: 'meta' as const,
              path: meta.path,
              data: { ...meta.data },
            })),
          ],
      };
    },
  };
}
