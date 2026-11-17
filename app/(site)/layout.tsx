import SiteChrome from '@/components/site/SiteChrome';

/** Public pages get the nav, the footer, and the skip link; /admin sits outside this group. */
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return <SiteChrome>{children}</SiteChrome>;
}
