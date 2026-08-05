import content from '../content.generated.json';
import { createFumadocsSource } from 'lume-cms/fumadocs';
import type { CompiledContent } from 'lume-cms';
import { lucideIconsPlugin } from 'fumadocs-core/source/lucide-icons';
import { docsContentRoute, docsImageRoute, docsRoute } from './shared';

interface PageFrontmatter extends Record<string, unknown> {
  title: string;
  description?: string;
  icon?: string;
  full?: boolean;
}

export const { getSource } = createFumadocsSource(content as CompiledContent<PageFrontmatter>, {
  baseUrl: docsRoute,
  plugins: [lucideIconsPlugin()],
});

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

${page.data.content}`;
}
