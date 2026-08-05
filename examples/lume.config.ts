import * as v from 'valibot';
import { defineConfig } from 'lume-cms/config';
import { schedule } from 'lume-cms/schedule';

export default defineConfig({
  content: {
    root: 'content/docs',
    include: ['content/docs/**/*.{md,mdx}'],
    schema: v.looseObject({
      title: v.string(),
      description: v.optional(v.string()),
      icon: v.optional(v.string()),
      full: v.optional(v.boolean()),
      draft: v.optional(v.boolean(), false),
    }),
  },
  plugins: [schedule()],
  output: 'content.generated.json',
});
