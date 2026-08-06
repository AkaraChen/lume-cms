import { metaSchema as fumadocsMetaSchema, pageSchema as fumadocsPageSchema } from 'fumadocs-core/source/schema';
import { z } from 'zod';

/** The exact Fumadocs baseline, exported so Zod users can extend it directly. */
export const officialPageSchema = fumadocsPageSchema;
export const officialMetaSchema = fumadocsMetaSchema;
export const defaultPageSchema = officialPageSchema.extend({
  /** lume-cms public page-data extension, used by search integrations. */
  tags: z.array(z.string()).optional(),
});
export const defaultMetaSchema = officialMetaSchema;
