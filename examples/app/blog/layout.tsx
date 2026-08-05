import Link from 'next/link';
import type { ReactNode } from 'react';
import type { NavigationNode } from 'lume-cms';
import { contentSource } from '../source';

export const dynamic = 'force-dynamic';

function Navigation({ nodes }: { nodes: NavigationNode[] }) {
  return <ul>{nodes.map((node) => <li key={node.slug?.join('/') ?? node.name}>
    {node.slug ? <Link href={`/blog/${node.slug.join('/')}`}>{node.name}</Link> : node.name}
    {node.children ? <Navigation nodes={node.children} /> : null}
  </li>)}</ul>;
}

export default function BlogLayout({ children }: { children: ReactNode }) {
  return <div style={{ display: 'grid', gridTemplateColumns: '16rem 1fr', gap: '2rem' }}>
    <nav aria-label="Content navigation"><Navigation nodes={contentSource.getNavigationTree()} /></nav>
    <main>{children}</main>
  </div>;
}
