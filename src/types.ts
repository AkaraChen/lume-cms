import type { StructuredData } from 'fumadocs-core/mdx-plugins';

export interface TocItem {
  title: string;
  url: string;
  depth: number;
}

export interface CompiledBody {
  /** Source Markdown/MDX, kept for text exports such as `llms.txt`. */
  markdown: string;
  /** Compiled MDX function body, evaluated on the server to render React. */
  code: string;
  toc: TocItem[];
  structuredData: StructuredData;
}

export interface CompiledMeta<Data extends Record<string, unknown> = Record<string, unknown>> {
  /** Path relative to the content root, the way Fumadocs addresses files. */
  path: string;
  data: Data;
}

export interface CompiledEntry<Data extends Record<string, unknown> = Record<string, unknown>> {
  id: string;
  slug: string[];
  /** Path relative to the content root, the way Fumadocs addresses files. */
  path: string;
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

export type PublicEntry<Data extends Record<string, unknown> = Record<string, unknown>> = Omit<
  CompiledEntry<Data>,
  'publishAtMs' | 'draft'
>;
