import { collection, defineConfig } from 'lume-cms/config';
import { lucideIconsPlugin } from 'fumadocs-core/source/lucide-icons';
import { schedule } from 'lume-cms/schedule';

export default defineConfig({
  collections: {
    docs: collection({
      baseUrl: '/docs',
      root: 'content/docs',
      include: ['**/*.{md,mdx}'],
      loaderPlugins: [lucideIconsPlugin()],
    }),
    blog: collection({
      baseUrl: '/blog',
      root: 'content/blog',
      include: ['**/*.{md,mdx}'],
      plugins: [schedule()],
    }),
  },
  output: 'content.generated.json',
});
