import { getSource } from '../../source';

export const dynamic = 'force-dynamic';

export async function GET() {
  const pages = (await getSource()).getPages().map((page) => ({
    title: page.data.title,
    url: page.url,
    content: page.data.body.markdown,
  }));
  return Response.json(pages);
}
