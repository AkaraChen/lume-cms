import { getMDXComponents } from '@/components/mdx';
import { getBlogSource } from '@/lib/source';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function BlogPost(props: PageProps<'/blog/[...slug]'>) {
  const { slug } = await props.params;
  const page = (await getBlogSource()).getPage(slug);
  if (!page) notFound();
  const MDX = page.data.body;

  return (
    <article className="mx-auto w-full max-w-3xl px-6 py-16">
      <header className="mb-10 border-b pb-8">
        <div className="mb-3 flex flex-wrap gap-3 text-sm text-fd-muted-foreground">
          {page.data.publishDate && <time dateTime={page.data.publishDate}>{new Date(page.data.publishDate).toLocaleDateString('en', { dateStyle: 'long' })}</time>}
          {page.data.tags?.map((tag) => <span key={tag}>#{tag}</span>)}
        </div>
        <h1 className="text-4xl font-semibold tracking-tight">{page.data.title}</h1>
        {page.data.description && <p className="mt-4 text-lg text-fd-muted-foreground">{page.data.description}</p>}
      </header>
      <div className="prose min-w-0">
        <MDX components={getMDXComponents()} />
      </div>
    </article>
  );
}

export async function generateMetadata(props: PageProps<'/blog/[...slug]'>): Promise<Metadata> {
  const { slug } = await props.params;
  const page = (await getBlogSource()).getPage(slug);
  if (!page) notFound();
  return { title: page.data.title, description: page.data.description };
}
