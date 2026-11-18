import type { ReactNode } from 'react';
import { lastContentUpdate } from '@/lib/history';
import { navItemsFor, siteData, socialLinksFor } from '@/lib/site';
import { UI } from '@/lib/strings';
import { themeFromSetting } from '@/lib/theme';
import Footer from './Footer';
import Nav from './Nav';
import SheetFrame from './SheetFrame';

/**
 * The public frame around every page (ARCHITECTURE.md 5, Global; the canvas's page frame):
 *
 *   .ar-frame.ar-page.hm         the `frame` container the design's container queries read
 *     a.ar-skip                  the skip link
 *     .ar-backdrop               Blueprint's static sky: the token gradient and the ground grid
 *     .hm-body                   inside the sheet frame's inset from 1024 px
 *       header.ar-nav            the sticky nav
 *       main#main.hm-main        the page
 *       .hm-foot > footer        the footer
 *     .ar-sheetframe             the drawing border with its zone marks, 1024 px and up
 *
 * Pages put their content in `main` (see app/styles/frame.css for .hm-wrap and .hm-sec).
 */
export default function SiteChrome({ children }: { children: ReactNode }) {
  const { site, projects, resolveLink } = siteData();
  const { personal, settings } = site;
  const theme = themeFromSetting(settings.themeDefault);

  return (
    <div className="ar-frame ar-page hm">
      <a href="#main" className="ar-skip">
        {UI.site.skipToContent}
      </a>
      <div className="ar-backdrop" aria-hidden="true" />
      <div className="hm-body">
        <Nav
          name={personal.name}
          items={navItemsFor(site, resolveLink)}
          socials={socialLinksFor(site, 'nav')}
          availability={settings.showAvailabilityBadge ? personal.availability : undefined}
          theme={theme}
        />
        <main id="main" tabIndex={-1} className="hm-main">
          {children}
        </main>
        <div className="hm-foot">
          <Footer
            name={personal.name}
            tagline={personal.tagline}
            email={personal.email}
            socials={socialLinksFor(site, 'footer')}
            updated={lastContentUpdate(projects.map((p) => p.slug))}
            year={new Date().getFullYear()}
          />
        </div>
      </div>
      <SheetFrame />
    </div>
  );
}
