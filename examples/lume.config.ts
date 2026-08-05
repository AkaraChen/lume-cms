import * as v from 'valibot';
import { defineConfig } from 'lume-cms/config';

export default defineConfig({
  content: {
    root: 'content/docs',
    include: ['content/docs/**/*.{md,mdx,json}'],
    schema: v.looseObject({
      title: v.string(),
      description: v.optional(v.string()),
      icon: v.optional(v.string()),
      full: v.optional(v.boolean()),
      publishDate: v.optional(v.string()),
      draft: v.optional(v.boolean(), false),
    }),
  },
  output: 'content.generated.json',
});
