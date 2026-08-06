import * as v from 'valibot';
import {
  definePlugin,
  defineTimeGate,
  type LumePlugin,
  type Next,
  type ResolvedEntry,
  type RuntimeContext,
} from './plugin.js';

const OFFSET_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

interface ScheduleExtension {
  publishDate: string | null;
  publishAtMs: number | null;
}

function extension(entry: { ext: Record<string, unknown> }): ScheduleExtension {
  return entry.ext.schedule as ScheduleExtension;
}

type SchedulePlugin = LumePlugin<
  { publishDate?: string },
  { publishDate: string | null }
>;

export interface ScheduleOptions {
  field?: string;
  /** Sort pages newest-first by publish date. Disabled by default so `meta.json` owns docs ordering. */
  sort?: 'date-desc';
}

export function schedule(options: ScheduleOptions = {}): SchedulePlugin {
  const field = options.field ?? 'publishDate';
  const gate = defineTimeGate({
    reason: 'future',
    at: (entry) => extension(entry.compiled).publishAtMs,
    invalidate: (entry) => !entry.compiled.draft,
  });
  return definePlugin<{ publishDate?: string }, { publishDate: string | null }>({
    id: 'schedule',
    frontmatter: {
      schema: v.object({ [field]: v.optional(v.string()) }),
    },
    build: {
      cacheKey: JSON.stringify({ field, sort: options.sort }),
      entry({ frontmatter, sourcePath }) {
        const value = frontmatter[field];
        if (value === undefined || value === null) return { publishDate: null, publishAtMs: null };
        if (typeof value !== 'string' || !OFFSET_DATE_TIME.test(value)) {
          throw new Error(`${sourcePath}: invalid ${field} ${JSON.stringify(value)}; expected ISO 8601 with Z or an offset`);
        }
        const publishAtMs = new Date(value).getTime();
        if (!Number.isFinite(publishAtMs)) throw new Error(`${sourcePath}: invalid ${field} ${JSON.stringify(value)}`);
        return { publishDate: value, publishAtMs };
      },
    },
    runtime: {
      ...gate,
      resolve(entry, context, next) {
        entry.patchData({ publishDate: extension(entry.compiled).publishDate });
        gate.resolve!(entry, context, next);
      },
      ...(options.sort === 'date-desc' && {
        list: (_entries: readonly ResolvedEntry[], _context: RuntimeContext, next: Next<ResolvedEntry[]>) => (
          next().sort((a, b) => (
            (extension(b.compiled).publishAtMs ?? -Infinity)
            - (extension(a.compiled).publishAtMs ?? -Infinity)
          ))
        ),
      }),
    },
  });
}
