import Link from 'next/link';
import type { ReactNode } from 'react';
import LinkIcon from '@/components/LinkIcon';
import { hasText } from '@/lib/format';
import { lastContentUpdate } from '@/lib/history';
import { navItemsFor, siteData, socialLinksFor } from '@/lib/site';
import { UI } from '@/lib/strings';
import MobileMenu from './MobileMenu';
import NavLinks from './NavLinks';
import ThemeToggle from './ThemeToggle';

/**
 * The public frame around every page (ARCHITECTURE.md 5, Global): a skip link, the sticky nav
 * from the content's nav list, the main landmark, and the footer with the tagline, the email,
 * the footer links, the last-updated date, and the copyright year.
 */
export default function SiteChrome({ children }: { children: ReactNode }) {
  const { site, projects, resolveLink } = siteData();
  const navItems = navItemsFor(site, resolveLink);
  const themeLabels = { toBlueprint: UI.site.toBlueprint, toWhiteprint: UI.site.toWhiteprint };
  const menuLabels = {
    ...themeLabels,
    open: UI.site.openMenu,
    close: UI.site.closeMenu,
    title: UI.site.menu,
    nav: UI.site.primaryNav,
    home: UI.site.home,
  };
  const navSocials = socialLinksFor(site, 'nav');
  const footerSocials = socialLinksFor(site, 'footer');
  const updated = lastContentUpdate(projects.map((p) => p.slug));
  const year = new Date().getFullYear();

  return (
    <>
      <a
        href="#main"
        className="sr-only z-[70] rounded-sm bg-accent px-4 py-3 text-accent-contrast focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:inline-flex focus:min-h-[44px] focus:items-center focus:px-4 focus:py-3"
      >
        {UI.site.skipToContent}
      </a>
      <header className="sticky top-0 z-40 border-b border-line bg-bg">
        <div className="wrap flex min-h-[64px] items-center justify-between gap-4">
          <Link href="/" className="inline-flex min-h-[44px] items-center font-semibold text-ink">
            {site.personal.name}
          </Link>
          <nav aria-label={UI.site.primaryNav} className="hidden lg:block">
            <NavLinks items={navItems} className="flex items-center gap-6" />
          </nav>
          <div className="flex items-center gap-1">
            {navSocials.map((social) => (
              <a
                key={social.id}
                href={social.url}
                rel="noopener noreferrer"
                className="hidden min-h-[44px] min-w-[44px] items-center justify-center gap-2 rounded-sm px-2 text-sm text-ink-dim hover:text-ink lg:inline-flex"
              >
                <LinkIcon icon={social.icon} size={16} />
                <span>{social.label}</span>
              </a>
            ))}
            <ThemeToggle labels={themeLabels} />
            <MobileMenu
              items={navItems}
              socials={navSocials.map((s) => ({ label: s.label, url: s.url, icon: s.icon }))}
              labels={menuLabels}
            />
          </div>
        </div>
      </header>

      <main id="main" tabIndex={-1} className="outline-none">
        {children}
      </main>

      <footer className="border-t border-line">
        <div className="wrap grid gap-8 py-12 md:grid-cols-[1.4fr_1fr]">
          <div className="space-y-3">
            {hasText(site.personal.tagline) && <p className="max-w-md text-lg text-ink">{site.personal.tagline}</p>}
            {hasText(site.personal.email) && (
              <p>
                <a href={`mailto:${site.personal.email}`} className="text-link inline-flex min-h-[44px] items-center">
                  {site.personal.email}
                </a>
              </p>
            )}
          </div>
          <div className="space-y-4 md:justify-self-end">
            {footerSocials.length > 0 && (
              <ul aria-label={UI.site.footerNav} className="flex flex-wrap gap-x-5 gap-y-1">
                {footerSocials.map((social) => (
                  <li key={social.id}>
                    <a
                      href={social.url}
                      rel="noopener noreferrer"
                      className="inline-flex min-h-[44px] items-center gap-2 text-sm text-ink-dim hover:text-ink"
                    >
                      <LinkIcon icon={social.icon} size={16} />
                      {social.label}
                    </a>
                  </li>
                ))}
              </ul>
            )}
            <p className="data text-xs text-ink-mute">
              {updated && (
                <>
                  {UI.site.lastUpdated} <time dateTime={updated}>{updated}</time>
                  <span aria-hidden> · </span>
                </>
              )}
              {UI.site.copyright(year, site.personal.name)}
            </p>
          </div>
        </div>
      </footer>
    </>
  );
}
