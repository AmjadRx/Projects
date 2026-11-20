import CardTransitionListener from '@/components/sheet/CardTransitionListener';
import SiteChrome from '@/components/site/SiteChrome';

/**
 * Public pages get the nav, the footer, and the skip link; /admin sits outside this group. Every
 * public page also loads the card transition's Back listener while it hydrates (renders nothing).
 */
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <CardTransitionListener />
      <SiteChrome>{children}</SiteChrome>
    </>
  );
}
