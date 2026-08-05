import * as v from 'valibot';
import { defineConfig } from 'lume-cms/config';
import { schedule } from 'lume-cms/schedule';

export default defineConfig({
  collections: {
    docs: {
      baseUrl: '/docs',
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
    blog: {
      baseUrl: '/blog',
      root: 'content/blog',
      include: ['content/blog/**/*.{md,mdx}'],
      schema: v.looseObject({
        title: v.string(),
        description: v.optional(v.string()),
        tags: v.optional(v.array(v.string())),
        draft: v.optional(v.boolean(), false),
      }),
    },
  },
  plugins: [schedule()],
  output: 'content.generated.json',
});
