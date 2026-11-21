import { ArrowRight } from 'lucide-react';
import Button from '@/components/sheet/Button';
import Placeholder from '@/components/sheet/Placeholder';
import SiteChrome from '@/components/site/SiteChrome';
import { siteData } from '@/lib/site';
import { UI } from '@/lib/strings';

export const metadata = { title: UI.notFound.heading, robots: { index: false, follow: false } };

/**
 * "Sheet not found" (ARCHITECTURE.md 5), the one centered page, as the NotFound board draws it: an
 * empty drawing well, the heading and its line, and two buttons, the projects first (the page's one
 * primary button) and home. Both links go through the link resolver, so they only lead to pages the
 * site renders. The block fills the first screen under the nav; the footer follows below.
 */
export default function NotFound() {
  const { resolveLink } = siteData();
  const projects = resolveLink('/projects');
  const home = resolveLink('/');
  return (
    <SiteChrome>
      <div className="hm-wrap st-404">
        <div className="ar-well st-404__well" aria-hidden="true">
          <Placeholder text={UI.notFound.well} />
        </div>
        <h1 className="st-title">{UI.notFound.heading}</h1>
        <p className="st-sub">{UI.notFound.line}</p>
        {projects || home ? (
          <div className="st-404__actions">
            {projects ? (
              <Button variant="primary" href={projects.href} icon={ArrowRight}>
                {UI.notFound.projects}
              </Button>
            ) : null}
            {home ? (
              <Button variant={projects ? 'secondary' : 'primary'} href={home.href}>
                {UI.notFound.home}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </SiteChrome>
  );
}
