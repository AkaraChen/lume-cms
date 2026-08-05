import { ImageResponse } from 'next/og';
import { notFound } from 'next/navigation';
import { getSource } from '../../source';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string[] }> }) {
  const page = (await getSource()).getPage((await params).slug);
  if (!page) notFound();
  return new ImageResponse(<div style={{ fontSize: 64 }}>{page.data.title}</div>);
}
