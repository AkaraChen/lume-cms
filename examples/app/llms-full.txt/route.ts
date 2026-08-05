import { getAllPages, getLLMText } from '@/lib/source';

export const dynamic = 'force-dynamic';

export async function GET() {
  const scan = (await getAllPages()).map(getLLMText);
  const scanned = await Promise.all(scan);

  return new Response(scanned.join('\n\n'));
}
