import { getBlogSource } from '@/lib/source';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function BlogPage() {
  const pages = (await getBlogSource()).getPages();

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-16">
      <header className="mb-10">
        <p className="mb-2 text-sm font-medium text-fd-muted-foreground">Journal</p>
        <h1 className="text-4xl font-semibold tracking-tight">Blog</h1>
        <p className="mt-3 text-fd-muted-foreground">Notes on content, publishing, and Fumadocs.</p>
      </header>
      {pages.length === 0 ? (
        <p className="rounded-xl border border-dashed p-8 text-center text-fd-muted-foreground">No published posts yet.</p>
      ) : (
        <div className="divide-y">
          {pages.map((page) => (
            <article key={page.url} className="py-7 first:pt-0">
              <Link href={page.url} className="group block">
                <div className="mb-2 flex flex-wrap items-center gap-3 text-sm text-fd-muted-foreground">
                  {page.data.publishDate && <time dateTime={page.data.publishDate}>{new Date(page.data.publishDate).toLocaleDateString('en', { dateStyle: 'long' })}</time>}
                  {page.data.tags?.map((tag) => <span key={tag}>#{tag}</span>)}
                </div>
                <h2 className="text-2xl font-medium tracking-tight group-hover:underline">{page.data.title}</h2>
                {page.data.description && <p className="mt-2 text-fd-muted-foreground">{page.data.description}</p>}
              </Link>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
