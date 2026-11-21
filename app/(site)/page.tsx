import { Suspense } from 'react';
import type { Metadata } from 'next';
import Hero from '@/components/home/Hero';
import { AboutTeaser, ContactCall, NowList, Readouts, SelectedWork, Thesis, ToolsStrip } from '@/components/home/HomeSections';
import { JsonLd, pageMetadata } from '@/lib/meta';
import { homeMetaImage } from '@/lib/og/meta';
import { siteData } from '@/lib/site';
import { personJsonLd } from '@/lib/structured-data';

export function generateMetadata(): Metadata {
  const { site } = siteData();
  return pageMetadata(site, { description: site.seo.description, path: '/', image: homeMetaImage(site) });
}

/**
 * The home page (ARCHITECTURE.md 5). Each section after the hero sits in a Suspense boundary of its
 * own: the server sends the whole page as before (a boundary adds only two HTML comments), and in
 * the browser React hydrates the hero first, then each later section on its own, in short slices
 * between frames, so no one long task holds the page while it becomes interactive (ARCHITECTURE.md
 * 9: TBT, the lab's stand-in for INP). A click on a section that has not hydrated yet hydrates it
 * at once.
 */
export default function HomePage() {
  const { site, projects, resolveLink } = siteData();
  return (
    <>
      <JsonLd data={personJsonLd(site)} />
      <Hero site={site} projects={projects} />
      <Suspense>
        <Readouts stats={site.stats} resolveLink={resolveLink} projects={projects} />
      </Suspense>
      <Suspense>
        <Thesis thesis={site.thesis} />
      </Suspense>
      <Suspense>
        <NowList now={site.now} resolveLink={resolveLink} />
      </Suspense>
      <Suspense>
        <SelectedWork projects={projects} />
      </Suspense>
      <Suspense>
        <AboutTeaser site={site} />
      </Suspense>
      <Suspense>
        <ToolsStrip skills={site.skills} />
      </Suspense>
      <Suspense>
        <ContactCall site={site} />
      </Suspense>
    </>
  );
}
