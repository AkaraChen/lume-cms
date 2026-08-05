import { getSource } from '@/lib/source';

export const dynamic = 'force-dynamic';

export async function GET() {
  const items = (await getSource()).getPages().map((page) => `<item><title>${page.data.title}</title><link>${page.url}</link></item>`).join('');
  return new Response(`<rss version="2.0"><channel>${items}</channel></rss>`, {
    headers: { 'content-type': 'application/rss+xml' },
  });
}
