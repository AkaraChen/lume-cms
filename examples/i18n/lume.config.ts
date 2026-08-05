import { defineConfig } from 'lume-cms/config';
import { i18n } from './lib/i18n';

export default defineConfig({
  collections: { default: {
    baseUrl: '/docs',
    i18n,
    root: 'content',
    include: ['**/*.{md,mdx}'],
  } },
});
