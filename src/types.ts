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

export interface CompiledEntry<Data extends Record<string, unknown> = Record<string, unknown>> {
  slug: string[];
  /** Path relative to the content root, the way Fumadocs addresses files. */
  path: string;
  draft: boolean;
  data: Data;
  ext: Record<string, unknown>;
  body: CompiledBody;
}

export interface CompiledCollection<Data extends Record<string, unknown> = Record<string, unknown>> {
  plugins: string[];
  entries: CompiledEntry<Data>[];
}

export interface CompiledContent<Data extends Record<string, unknown> = Record<string, unknown>> {
  schemaVersion: 3;
  collections: Record<string, CompiledCollection<Data>>;
}
