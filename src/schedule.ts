import * as z from 'zod/mini';
import {
  definePlugin,
  defineTimeGate,
  type LumePlugin,
  type Next,
  type ResolvedEntry,
  type RuntimeContext,
} from './plugin.js';

const offsetDateTime = z.iso.datetime({ offset: true });

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
      schema: z.object({ [field]: z.optional(z.string()) }),
    },
    build: {
      cacheKey: JSON.stringify({ field, sort: options.sort }),
      entry({ frontmatter, sourcePath }) {
        const value = frontmatter[field] as string | undefined;
        if (value === undefined) return { publishDate: null, publishAtMs: null };
        if (!z.safeParse(offsetDateTime, value).success) {
          throw new Error(`${sourcePath}: invalid ${field} ${JSON.stringify(value)}; expected ISO 8601 with Z or an offset`);
        }
        return { publishDate: value, publishAtMs: new Date(value).getTime() };
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
