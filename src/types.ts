import type { StructuredData } from 'fumadocs-core/mdx-plugins';
import type { MetaData } from 'fumadocs-core/source';
import type { CompiledI18nConfig } from './i18n.js';

export interface TocItem {
  title: string;
  url: string;
  depth: number;
}

export interface CompiledBody {
  /** Original Markdown/MDX source body, without frontmatter. */
  markdown: string;
  /** Pure Markdown produced after remark transforms. */
  processedMarkdown: string;
  /** Compiled MDX function body, evaluated on the server to render React. */
  code: string;
  toc: TocItem[];
  structuredData: StructuredData;
}

export interface CompiledEntry<Data extends Record<string, unknown> = Record<string, unknown>> {
  slug: string[];
  /** Concrete locale, or `$` for a file shared across every configured language. */
  locale?: string;
  /** Path relative to the content root, the way Fumadocs addresses files. */
  path: string;
  draft: boolean;
  data: Data;
  ext: Record<string, unknown>;
  body: CompiledBody;
}

export interface CompiledMeta<Data extends MetaData = MetaData> {
  /** Concrete locale, or `$` for a file shared across every configured language. */
  locale?: string;
  /** Path relative to the content root, including the `meta.json` filename. */
  path: string;
  data: Data;
}

export interface CompileDiagnostic {
  code: 'missing-page' | 'missing-anchor' | 'missing-resource';
  severity: 'warning';
  sourcePath: string;
  line: number;
  column: number;
  target: string;
  message: string;
}

export interface CompiledCollection<Data extends Record<string, unknown> = Record<string, unknown>> {
  /** Public route prefix used by diagnostics and the matching Fumadocs loader. */
  baseUrl: string;
  /** Present when compilation used Fumadocs i18n. */
  i18n?: CompiledI18nConfig;
  plugins: string[];
  entries: CompiledEntry<Data>[];
  metas: CompiledMeta[];
  /** Deterministic build diagnostics for this isolated collection. */
  diagnostics?: CompileDiagnostic[];
}

export interface CompiledContent<Data extends Record<string, unknown> = Record<string, unknown>> {
  schemaVersion: 3;
  collections: Record<string, CompiledCollection<Data>>;
}
