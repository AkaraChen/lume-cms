export interface TocItem {
  title: string;
  url: string;
  depth: number;
}

export interface CompiledBody {
  markdown: string;
  html: string;
  toc: TocItem[];
}

export interface CompiledEntry<Data extends Record<string, unknown> = Record<string, unknown>> {
  id: string;
  slug: string[];
  sourcePath: string;
  publishDate: string | null;
  publishAtMs: number | null;
  draft: boolean;
  data: Data;
  body: CompiledBody;
}

export interface CompiledContent<Data extends Record<string, unknown> = Record<string, unknown>> {
  schemaVersion: 1;
  entries: CompiledEntry<Data>[];
}

export interface PublicEntry<Data extends Record<string, unknown> = Record<string, unknown>> {
  id: string;
  slug: string[];
  sourcePath: string;
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
