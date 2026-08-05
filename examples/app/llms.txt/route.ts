import { getAllSources } from '@/lib/source';
import { llms } from 'fumadocs-core/source';

export const dynamic = 'force-dynamic';

export async function GET() {
  const sources = await getAllSources();
  return new Response(Object.values(sources).map((source) => llms(source).index()).join('\n\n'));
}
