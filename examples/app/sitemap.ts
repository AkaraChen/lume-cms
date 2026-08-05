import type { MetadataRoute } from 'next';
import { getAllPages } from '@/lib/source';

export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  return (await getAllPages()).map((page) => ({ url: `https://example.com${page.url}` }));
}
