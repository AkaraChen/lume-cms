import content from '../content.generated.json';
import { cache } from 'react';
import { collection, createFumadocsSources, type CompiledContent } from 'lume-cms';
import { lucideIconsPlugin } from 'fumadocs-core/source/lucide-icons';
import { schedule } from 'lume-cms/schedule';
import { docsContentRoute, docsImageRoute, docsRoute } from './shared';

interface PageFrontmatter extends Record<string, unknown> {
  title: string;
  description?: string;
  icon?: string;
  full?: boolean;
  tags?: string[];
}

const requestNow = cache(() => new Date());

export const { sources, getAllSources, getAllPages } = createFumadocsSources(
  content as CompiledContent<PageFrontmatter>,
  {
    now: requestNow,
    collections: {
      docs: collection({
        baseUrl: docsRoute,
        plugins: [schedule()],
        loaderPlugins: [lucideIconsPlugin()],
      }),
      blog: collection({ baseUrl: '/blog', plugins: [schedule()] }),
    },
  },
);

export const { getPreviewSource, getSource } = sources.docs;
export const { getSource: getBlogSource } = sources.blog;

type Source = Awaited<ReturnType<typeof getSource>>;
type Page = Source['$inferPage'];

export function getPageImageUrl(page: Page) {
  const segments = [...page.slugs, 'image.png'];

  return {
    segments,
    url: '/' + [page.locale, ...docsImageRoute.split('/'), ...segments].filter(Boolean).join('/'),
  };
}

export function getPageMarkdownUrl(page: Page) {
  const segments = [...page.slugs, 'content.md'];

  return {
    segments,
    url: '/' + [page.locale, ...docsContentRoute.split('/'), ...segments].filter(Boolean).join('/'),
  };
}

export async function getLLMText(page: Page) {
  return `# ${page.data.title} (${page.url})

${page.data.processedMarkdown}`;
}
