import { baseOptions } from '@/lib/layout.shared';
import { HomeLayout } from 'fumadocs-ui/layouts/home';

export const dynamic = 'force-dynamic';

export default function Layout({ children }: LayoutProps<'/blog'>) {
  return <HomeLayout {...baseOptions()}>{children}</HomeLayout>;
}
