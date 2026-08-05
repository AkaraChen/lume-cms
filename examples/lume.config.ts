import { defineConfig } from 'lume-cms/config';
import { schedule } from 'lume-cms/schedule';

export default defineConfig({
  collections: {
    docs: {
      baseUrl: '/docs',
      root: 'content/docs',
      include: ['content/docs/**/*.{md,mdx}'],
    },
    blog: {
      baseUrl: '/blog',
      root: 'content/blog',
      include: ['content/blog/**/*.{md,mdx}'],
    },
  },
  plugins: [schedule()],
  output: 'content.generated.json',
});
