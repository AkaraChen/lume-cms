import { notFound } from 'next/navigation';
import { getSource } from '../../source';

export const dynamic = 'force-dynamic';
export const dynamicParams = true;

export async function generateStaticParams() {
  return (await getSource()).generateParams();
}

export default async function Page({ params }: { params: Promise<{ slug?: string[] }> }) {
  const page = (await getSource()).getPage((await params).slug ?? []);
  if (!page) notFound();
  return <article dangerouslySetInnerHTML={{ __html: page.data.body.html }} />;
}
