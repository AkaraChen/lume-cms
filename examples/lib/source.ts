import content from '../content.generated.json';
import config from '../lume.config';
import { createFumadocsSources, type CompiledContent } from 'lume-cms';
import { docsContentRoute, docsImageRoute } from './shared';

interface PageFrontmatter extends Record<string, unknown> {
  title: string;
  description?: string;
  icon?: string;
  full?: boolean;
  tags?: string[];
}

const { sources, getAllSources, getAllPages } = createFumadocsSources(
  content as CompiledContent<PageFrontmatter>,
  config,
);

export { getAllPages, getAllSources };

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
