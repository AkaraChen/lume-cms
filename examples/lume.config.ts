import * as v from 'valibot';
import { defineConfig } from 'lume-cms/config';

export default defineConfig({
  content: {
    root: 'content',
    include: ['content/**/*.{md,json}'],
    schema: v.looseObject({
      title: v.string(),
      description: v.optional(v.string()),
      publishDate: v.optional(v.string()),
      draft: v.optional(v.boolean(), false),
    }),
  },
  output: 'content.generated.json',
});
