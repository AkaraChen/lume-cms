import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CompiledEntry, CompileDiagnostic } from './types.js';
import {
  i18nUrl,
  localePathKey,
  parseI18nPath,
  type CompiledI18nConfig,
} from './i18n.js';

export interface ExtractedReference {
  kind: 'link' | 'image';
  target: string;
  line: number;
  column: number;
}

export interface ReferenceCollector {
  references: ExtractedReference[];
  anchors: string[];
}

export interface ReferenceEntry {
  sourcePath: string;
  entry: CompiledEntry;
  references: ExtractedReference[];
  anchors: string[];
}

interface AstNode {
  type?: string;
  url?: unknown;
  identifier?: unknown;
  name?: unknown;
  attributes?: AstAttribute[];
  children?: AstNode[];
  position?: { start?: { line?: number; column?: number } };
}

interface AstAttribute extends AstNode {
  value?: unknown;
}

const contentExtensions = new Set(['.md', '.mdx', '.markdown']);
const externalProtocol = /^[a-z][a-z\d+.-]*:/i;

function walk(node: AstNode, visit: (node: AstNode) => void) {
  visit(node);
  for (const child of node.children ?? []) walk(child, visit);
}

function location(node: AstNode): Pick<ExtractedReference, 'line' | 'column'> | undefined {
  const { line, column } = node.position?.start ?? {};
  if (typeof line !== 'number' || typeof column !== 'number') return;
  return { line, column };
}

export function createReferenceCollector(output: ReferenceCollector) {
  return function remarkCollectReferences() {
    return (tree: AstNode) => {
      const definitions = new Map<string, string>();
      walk(tree, (node) => {
        if (node.type === 'definition' && typeof node.identifier === 'string' && typeof node.url === 'string') {
          definitions.set(node.identifier.toLowerCase(), node.url);
        }
      });
      walk(tree, (node) => {
        const at = location(node);
        if (node.type === 'link' && typeof node.url === 'string' && at) {
          output.references.push({ kind: 'link', target: node.url, ...at });
        } else if (node.type === 'image' && typeof node.url === 'string' && at) {
          output.references.push({ kind: 'image', target: node.url, ...at });
        } else if (
          (node.type === 'linkReference' || node.type === 'imageReference')
          && typeof node.identifier === 'string'
          && at
        ) {
          const target = definitions.get(node.identifier.toLowerCase());
          if (target) {
            output.references.push({
              kind: node.type === 'imageReference' ? 'image' : 'link',
              target,
              ...at,
            });
          }
        } else if (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') {
          const attributeName = node.name === 'img' ? 'src' : node.name === 'a' ? 'href' : undefined;
          const attribute = attributeName
            ? node.attributes?.find((item) => item.type === 'mdxJsxAttribute' && item.name === attributeName)
            : undefined;
          const attributeLocation = attribute && location(attribute);
          if (attribute && typeof attribute.value === 'string' && attributeLocation) {
            output.references.push({
              kind: node.name === 'img' ? 'image' : 'link',
              target: attribute.value,
              ...attributeLocation,
            });
          }
        }
        if (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') {
          const id = node.attributes?.find((item) => item.type === 'mdxJsxAttribute' && item.name === 'id');
          if (id && typeof id.value === 'string') output.anchors.push(id.value);
        }
      });
    };
  };
}

function splitTarget(target: string): { pathname: string; hash?: string } | undefined {
  const trimmed = target.trim();
  if (!trimmed || trimmed.startsWith('//') || (externalProtocol.test(trimmed) && !trimmed.startsWith('file:'))) return;
  if (/[{}]/.test(trimmed)) return;
  const hashAt = trimmed.indexOf('#');
  const queryAt = trimmed.indexOf('?');
  const pathEnd = [hashAt, queryAt].filter((index) => index >= 0).reduce((a, b) => Math.min(a, b), trimmed.length);
  const rawPath = trimmed.slice(0, pathEnd);
  const rawHash = hashAt >= 0 ? trimmed.slice(hashAt + 1, queryAt > hashAt ? queryAt : undefined) : undefined;
  try {
    return {
      pathname: rawPath.startsWith('file:') ? rawPath : decodeURI(rawPath),
      hash: rawHash ? decodeURIComponent(rawHash) : undefined,
    };
  } catch {
    return;
  }
}

function normalizedVirtualPath(value: string): string {
  return path.posix.normalize(value.replace(/^\/+/, '')).replace(/\/+$/, '');
}

function stem(value: string): string {
  const extension = path.posix.extname(value).toLowerCase();
  const withoutExtension = contentExtensions.has(extension) ? value.slice(0, -extension.length) : value;
  return withoutExtension.endsWith('/index') ? withoutExtension.slice(0, -'/index'.length) : withoutExtension;
}

function isResource(reference: ExtractedReference, pathname: string): boolean {
  if (reference.kind === 'image' || pathname.startsWith('file:')) return true;
  const extension = path.posix.extname(pathname).toLowerCase();
  return extension.length > 0 && !contentExtensions.has(extension) && extension !== '.html' && extension !== '.htm';
}

async function isFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

function resourcePath(cwd: string, sourcePath: string, pathname: string): string | undefined {
  try {
    return pathname.startsWith('file:')
      ? fileURLToPath(pathname)
      : pathname.startsWith('/')
        ? path.resolve(cwd, 'public', pathname.slice(1))
        : path.resolve(cwd, path.dirname(sourcePath), pathname);
  } catch {
    return;
  }
}

function absoluteTarget(
  pathname: string,
  baseUrl: string,
  sourceLocale: string,
  i18n?: CompiledI18nConfig,
): { locale: string; slug: string } | undefined {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  const locales = !i18n || i18n.hideLocale === 'always' ? [sourceLocale] : i18n.languages;
  return locales
    .map((locale) => ({ locale, root: i18nUrl(baseUrl, [], locale, i18n).replace(/\/+$/, '') || '/' }))
    .filter(({ root }) => normalized === root || root === '/' || normalized.startsWith(`${root}/`))
    .sort((a, b) => b.root.length - a.root.length)
    .map(({ locale, root }) => ({
      locale,
      slug: normalized === root ? '' : root === '/' ? normalized.slice(1) : normalized.slice(root.length + 1),
    }))[0];
}

function localizedLookup<T>(
  map: Map<string, T>,
  locale: string,
  value: string,
  i18n?: CompiledI18nConfig,
): T | undefined {
  return map.get(localePathKey(locale, value))
    ?? (i18n?.fallbackLanguage && i18n.fallbackLanguage !== locale
      ? map.get(localePathKey(i18n.fallbackLanguage, value))
      : undefined);
}

function diagnostic(
  code: CompileDiagnostic['code'],
  sourcePath: string,
  reference: ExtractedReference,
  message: string,
): CompileDiagnostic {
  return {
    code,
    severity: 'warning',
    sourcePath,
    line: reference.line,
    column: reference.column,
    target: reference.target,
    message,
  };
}

export async function validateReferences(
  cwd: string,
  units: ReferenceEntry[],
  baseUrl = '/',
  i18n?: CompiledI18nConfig,
): Promise<CompileDiagnostic[]> {
  const bySlug = new Map<string, ReferenceEntry>();
  const byPath = new Map<string, ReferenceEntry>();
  const byStem = new Map<string, ReferenceEntry>();
  for (const unit of units) {
    const localizedPath = parseI18nPath(unit.entry.path, i18n);
    for (const locale of localizedPath.locales) {
      bySlug.set(localePathKey(locale, unit.entry.slug.join('/')), unit);
      const virtualPath = normalizedVirtualPath(localizedPath.path);
      byPath.set(localePathKey(locale, virtualPath), unit);
      byStem.set(localePathKey(locale, stem(virtualPath)), unit);
    }
  }

  const diagnostics: CompileDiagnostic[] = [];
  for (const unit of units) {
    for (const reference of unit.references) {
      const target = splitTarget(reference.target);
      if (!target) continue;
      const { pathname, hash } = target;
      if (isResource(reference, pathname)) {
        const filePath = resourcePath(cwd, unit.sourcePath, pathname);
        if (!filePath || !await isFile(filePath)) {
          diagnostics.push(diagnostic(
            'missing-resource',
            unit.sourcePath,
            reference,
            `Local resource ${JSON.stringify(reference.target)} does not exist`,
          ));
        }
        continue;
      }

      const localizedSource = parseI18nPath(unit.entry.path, i18n);
      const pages = localizedSource.locales.map((locale) => {
        if (!pathname) return unit;
        if (pathname.startsWith('/')) {
          const target = absoluteTarget(pathname, baseUrl, locale, i18n);
          if (target) {
            return localizedLookup(
              bySlug,
              target.locale,
              target.slug ? normalizedVirtualPath(target.slug) : '',
              i18n,
            );
          }
          return;
        }
        const extension = path.posix.extname(pathname).toLowerCase();
        const baseDir = path.posix.dirname(normalizedVirtualPath(localizedSource.path));
        const virtualTarget = normalizedVirtualPath(
          path.posix.join(baseDir, pathname),
        );
        if (contentExtensions.has(extension)) return localizedLookup(byPath, locale, virtualTarget, i18n);
        return localizedLookup(byStem, locale, stem(virtualTarget), i18n)
          ?? localizedLookup(bySlug, locale, stem(virtualTarget), i18n);
      });
      if (pages.some((page) => !page)) {
        const possibleResource = contentExtensions.has(path.posix.extname(pathname).toLowerCase())
          ? undefined
          : resourcePath(cwd, unit.sourcePath, pathname);
        if (possibleResource && await isFile(possibleResource)) continue;
        if (pathname !== '/') {
          diagnostics.push(diagnostic(
            'missing-page',
            unit.sourcePath,
            reference,
            `Content page ${JSON.stringify(reference.target)} does not exist`,
          ));
        }
        continue;
      }
      if (hash) {
        const normalizeAnchor = (value: string) => {
          try {
            return decodeURIComponent(value);
          } catch {
            return value;
          }
        };
        const page = pages.find((candidate) => {
          const anchors = new Set([
            ...candidate!.entry.body.toc.map((item) => normalizeAnchor(item.url.replace(/^#/, ''))),
            ...candidate!.anchors,
          ]);
          return !anchors.has(normalizeAnchor(hash));
        });
        if (page) {
          diagnostics.push(diagnostic(
            'missing-anchor',
            unit.sourcePath,
            reference,
            `Heading anchor ${JSON.stringify(hash)} does not exist in ${JSON.stringify(page.entry.path)}`,
          ));
        }
      }
    }
  }
  return diagnostics.sort((a, b) => (
    a.sourcePath.localeCompare(b.sourcePath)
    || a.line - b.line
    || a.column - b.column
    || a.code.localeCompare(b.code)
    || a.target.localeCompare(b.target)
  ));
}
