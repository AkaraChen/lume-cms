import type { MetadataRoute } from 'next';
import { getSource } from './source';

export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  return (await getSource()).getPages().map((page) => ({ url: `https://example.com${page.url}` }));
}
