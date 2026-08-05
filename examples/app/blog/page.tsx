import { getSource } from '../source';

export const dynamic = 'force-dynamic';

export default async function BlogIndex() {
  return <ul>{(await getSource()).getPages().map((page) => <li key={page.url}>{page.data.title}</li>)}</ul>;
}
