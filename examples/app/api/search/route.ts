import { getAllSources } from '@/lib/source';
import { createSearchAPI } from 'fumadocs-core/search/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const loaded = await getAllSources();
  const api = createSearchAPI('advanced', {
    indexes: Object.entries(loaded).flatMap(([tag, source]) => source.getPages().map((page) => ({
      id: `${tag}:${page.url}`,
      title: page.data.title,
      description: page.data.description,
      url: page.url,
      locale: page.locale,
      tag: [tag, ...(page.data.tags ?? [])],
      structuredData: page.data.structuredData,
    }))),
  });
  return api.GET(request);
}
