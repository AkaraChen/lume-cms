import { getSource } from '@/lib/source';
import { llms } from 'fumadocs-core/source';

export const dynamic = 'force-dynamic';

export async function GET() {
  return new Response(llms(await getSource()).index());
}
