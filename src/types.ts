import type { StructuredData } from 'fumadocs-core/mdx-plugins';

export interface TocItem {
  title: string;
  url: string;
  depth: number;
}

export interface CompiledBody {
  format: 'markdown' | 'mdx';
  markdown: string;
  html: string;
  /** Compiled MDX function body used for server-side React rendering. */
  code?: string;
  toc: TocItem[];
  structuredData?: StructuredData;
}

export interface CompiledMeta<Data extends Record<string, unknown> = Record<string, unknown>> {
  path: string;
  sourcePath: string;
  virtualPath?: string;
  data: Data;
}

export interface CompiledEntry<Data extends Record<string, unknown> = Record<string, unknown>> {
  id: string;
  slug: string[];
  sourcePath: string;
  virtualPath?: string;
  publishDate: string | null;
  publishAtMs: number | null;
  draft: boolean;
  data: Data;
  body: CompiledBody;
}

export interface CompiledContent<Data extends Record<string, unknown> = Record<string, unknown>> {
  schemaVersion: 1;
  entries: CompiledEntry<Data>[];
  metas?: CompiledMeta[];
}

export interface PublicEntry<Data extends Record<string, unknown> = Record<string, unknown>> {
  id: string;
  slug: string[];
  sourcePath: string;
  virtualPath?: string;
  publishDate: string | null;
  data: Data;
  body: CompiledBody;
}

export interface NavigationNode {
  name: string;
  slug?: string[];
  entry?: PublicEntry;
  children?: NavigationNode[];
}
