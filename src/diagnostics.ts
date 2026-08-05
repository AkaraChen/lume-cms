import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CompiledEntry, CompileDiagnostic } from './types.js';

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
  return path.posix.normalize(value.replace(/^\/+/, ''));
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

export async function validateReferences(cwd: string, units: ReferenceEntry[]): Promise<CompileDiagnostic[]> {
  const bySlug = new Map<string, ReferenceEntry>();
  const byPath = new Map<string, ReferenceEntry>();
  const byStem = new Map<string, ReferenceEntry>();
  for (const unit of units) {
    bySlug.set(unit.entry.slug.join('/'), unit);
    const virtualPath = normalizedVirtualPath(unit.entry.path);
    byPath.set(virtualPath, unit);
    byStem.set(stem(virtualPath), unit);
  }

  const diagnostics: CompileDiagnostic[] = [];
  for (const unit of units) {
    for (const reference of unit.references) {
      const target = splitTarget(reference.target);
      if (!target) continue;
      const { pathname, hash } = target;
      if (isResource(reference, pathname)) {
        let filePath: string | undefined;
        try {
          filePath = pathname.startsWith('file:')
            ? fileURLToPath(pathname)
            : pathname.startsWith('/')
              ? path.resolve(cwd, 'public', pathname.slice(1))
              : path.resolve(cwd, path.dirname(unit.sourcePath), pathname);
        } catch {}
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

      let page: ReferenceEntry | undefined;
      if (!pathname) page = unit;
      else if (pathname === '/') page = bySlug.get('');
      else {
        const absolute = pathname.startsWith('/');
        const extension = path.posix.extname(pathname).toLowerCase();
        const baseDir = path.posix.dirname(normalizedVirtualPath(unit.entry.path));
        const virtualTarget = normalizedVirtualPath(absolute ? pathname : path.posix.join(baseDir, pathname));
        if (contentExtensions.has(extension)) page = byPath.get(virtualTarget);
        else {
          page = byStem.get(stem(virtualTarget));
          if (!page) {
            const slugTarget = absolute ? normalizedVirtualPath(pathname) : stem(virtualTarget);
            page = bySlug.get(slugTarget);
          }
        }
      }
      if (!page) {
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
        const anchors = new Set([
          ...page.entry.body.toc.map((item) => normalizeAnchor(item.url.replace(/^#/, ''))),
          ...page.anchors,
        ]);
        if (!anchors.has(normalizeAnchor(hash))) {
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
