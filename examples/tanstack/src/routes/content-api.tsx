import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/content-api')({
  loader: async () => {
    const response = await fetch('/api/content/collections');
    if (!response.ok) throw new Error(`Content API returned ${response.status}`);
    return response.json() as Promise<Array<{ name: string; pageCount: number }>>;
  },
  component: ContentApiPage,
});

function ContentApiPage() {
  const collections = Route.useLoaderData();
  return <pre>{JSON.stringify(collections, null, 2)}</pre>;
}
