import type { MetadataRoute } from 'next';
import { getSource } from './source';

// Metadata routes are static by default. ISR is shown here as the documented alternative.
export const revalidate = 60;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  return (await getSource()).getPages().map((page) => ({ url: `https://example.com${page.url}` }));
}
