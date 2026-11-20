import type { Metadata } from 'next';
import Timeline from '@/components/sheet/Timeline';
import { pageMetadata } from '@/lib/meta';
import { homeMetaImage } from '@/lib/og/meta';
import { navLabel, siteData } from '@/lib/site';

export function generateMetadata(): Metadata {
  const { site } = siteData();
  return pageMetadata(site, { title: navLabel(site, '/experience', 'Experience'), description: site.seo.description, path: '/experience', image: homeMetaImage(site) });
}

/**
 * The timeline of roles with bullets (ARCHITECTURE.md 5), newest first as the content orders them,
 * on the bundle's Timeline. Each role is an h2 (docs/V3_PLAN.md D-67); the Timeline applies the
 * hiding rules.
 */
export default function ExperiencePage() {
  const { site } = siteData();
  const title = navLabel(site, '/experience', 'Experience');
  return (
    <div className="hm-wrap st-page">
      <header className="st-head">
        <h1 className="st-title">{title}</h1>
      </header>
      <Timeline roles={site.experience} label={title} headingLevel={2} />
    </div>
  );
}
