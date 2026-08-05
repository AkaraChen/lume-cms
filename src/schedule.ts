import * as v from 'valibot';
import { definePlugin, type LumePlugin } from './plugin.js';

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
  return definePlugin({
    id: 'schedule',
    frontmatter: {
      schema: v.object({ [field]: v.optional(v.string()) }),
    },
    compile: {
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
      visible: (entry, { nowMs }) => extension(entry).publishAtMs === null || extension(entry).publishAtMs! <= nowMs,
      deadline: (entries, { nowMs }) => entries
        .filter((entry) => !entry.draft)
        .map((entry) => extension(entry).publishAtMs)
        .filter((value): value is number => value !== null && value > nowMs)
        .reduce((next, value) => Math.min(next, value), Infinity),
      ...(options.sort === 'date-desc' && {
        compare: (a, b) => (extension(b).publishAtMs ?? -Infinity) - (extension(a).publishAtMs ?? -Infinity),
      }),
      pageData: (entry) => ({ publishDate: extension(entry).publishDate }),
    },
  });
}
