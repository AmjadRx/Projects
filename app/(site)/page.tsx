import type { Metadata } from 'next';
import Hero from '@/components/home/Hero';
import { AboutTeaser, ContactCall, NowList, Readouts, SelectedWork, Thesis, ToolsStrip } from '@/components/home/HomeSections';
import { hasText } from '@/lib/format';
import { resolveMedia } from '@/lib/media-server';
import { absoluteUrl, JsonLd, pageMetadata } from '@/lib/meta';
import { siteData, siteUrl, socialLinksFor } from '@/lib/site';

export function generateMetadata(): Metadata {
  const { site } = siteData();
  const ogImage = resolveMedia(site.seo.ogImage);
  return pageMetadata(site, {
    description: site.seo.description,
    path: '/',
    image: ogImage?.kind === 'image' ? ogImage.file.src : undefined,
  });
}

/**
 * Person JSON-LD from fields this page shows (docs/V3_PLAN.md D-41): `sameAs` holds only the
 * LinkedIn and GitHub profile links, and there is no telephone. The school is an `affiliation`,
 * not `alumniOf`: the degree is still in progress (education dates, "Graduation" in the hero).
 */
function personJsonLd(site: ReturnType<typeof siteData>['site']) {
  const { personal } = site;
  const profiles = socialLinksFor(site, 'footer')
    .map((link) => link.url)
    .filter((url) => /^https:\/\/(www\.)?(linkedin\.com|github\.com)\//i.test(url));
  const photo = resolveMedia(personal.photo);
  return {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: personal.name,
    url: siteUrl(),
    ...(hasText(personal.subTagline) ? { description: personal.subTagline } : {}),
    ...(hasText(personal.email) ? { email: `mailto:${personal.email}` } : {}),
    ...(hasText(personal.school) ? { affiliation: { '@type': 'CollegeOrUniversity', name: personal.school } } : {}),
    ...(photo?.kind === 'image' ? { image: absoluteUrl(photo.file.src) } : {}),
    ...(profiles.length > 0 ? { sameAs: profiles } : {}),
  };
}

export default function HomePage() {
  const { site, projects, resolveLink } = siteData();
  return (
    <>
      <JsonLd data={personJsonLd(site)} />
      <Hero site={site} projects={projects} />
      <Readouts stats={site.stats} resolveLink={resolveLink} />
      <Thesis thesis={site.thesis} />
      <NowList now={site.now} resolveLink={resolveLink} />
      <SelectedWork projects={projects} />
      <AboutTeaser site={site} />
      <ToolsStrip skills={site.skills} />
      <ContactCall site={site} />
    </>
  );
}
