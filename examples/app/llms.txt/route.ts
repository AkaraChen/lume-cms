import { getAllSources } from '@/lib/source';
import { llms } from 'fumadocs-core/source';

export const dynamic = 'force-dynamic';

export async function GET() {
  // Call llms() per source: the collections have distinct page-data types,
  // so a union element is not assignable to its invariant parameter.
  const { docs, blog } = await getAllSources();
  return new Response([llms(docs).index(), llms(blog).index()].join('\n\n'));
}
