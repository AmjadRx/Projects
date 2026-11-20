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

export default function HomePage() {
  const { site, projects, resolveLink } = siteData();
  return (
    <>
      <JsonLd data={personJsonLd(site)} />
      <Hero site={site} projects={projects} />
      <Readouts stats={site.stats} resolveLink={resolveLink} projects={projects} />
      <Thesis thesis={site.thesis} />
      <NowList now={site.now} resolveLink={resolveLink} />
      <SelectedWork projects={projects} />
      <AboutTeaser site={site} />
      <ToolsStrip skills={site.skills} />
      <ContactCall site={site} />
    </>
  );
}
