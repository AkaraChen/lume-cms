import { defineConfig } from 'lume-cms/config';
import { i18n } from './lib/i18n';

export default defineConfig({
  baseUrl: '/docs',
  i18n,
  content: {
    root: 'content',
    include: ['content/**/*.{md,mdx}'],
  },
});
