import type { Metadata } from 'next';
import { loadContent, lastUpdated } from '@/lib/content';
import Nav from '@/components/Nav';
import Footer from '@/components/Footer';
import Reveal from '@/components/Reveal';
import MediaView, { MediaPlaceholder } from '@/components/MediaView';
import Thesis from '@/components/home/Thesis';
import SkillsSection from '@/components/home/SkillsSection';
import HonorsList from '@/components/home/HonorsList';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'About',
  description:
    'Senior honors EE + ME at Santa Clara University working across high-voltage power electronics, embedded firmware, and autonomous aircraft.',
};

export default function AboutPage() {
  const { site } = loadContent();
  const photo = site.about.headshot ?? site.personal.photo;

  return (
    <>
      <Nav name={site.personal.name} items={site.nav} socials={site.socialLinks} />
      <main className="pb-12 pt-28 md:pt-40">
        <section className="wrap">
          <div className="grid grid-cols-1 gap-10 md:grid-cols-12">
            <div className="md:col-span-7">
              <Reveal>
                <p className="kicker">About</p>
                <h1 className="display-1 mt-5">{site.about.heading}</h1>
              </Reveal>
              <div className="mt-8 flex flex-col gap-6">
                {site.about.paragraphs.map((paragraph, i) => (
                  <Reveal key={i} delay={i * 0.08}>
                    <p className="body-lg">{paragraph}</p>
                  </Reveal>
                ))}
              </div>
            </div>
            <div className="md:col-span-4 md:col-start-9">
              <Reveal>
                <div
                  className="relative aspect-[4/5] w-full max-w-[320px] overflow-hidden rounded-lg"
                  style={{ border: '1px solid var(--line)' }}
                >
                  {photo ? (
                    <MediaView media={photo} placeholderLabel={site.personal.name} sizes="320px" />
                  ) : (
                    <MediaPlaceholder label={site.personal.name} />
                  )}
                </div>
              </Reveal>
              <Reveal delay={0.1}>
                <dl className="mt-8 flex flex-col">
                  {site.about.facts.map((fact) => (
                    <div
                      key={fact.label}
                      className="flex items-baseline justify-between gap-4 py-3"
                      style={{ borderBottom: '1px solid var(--line)' }}
                    >
                      <dt className="kicker">{fact.label}</dt>
                      <dd className="text-right text-sm font-medium text-ink">{fact.value}</dd>
                    </div>
                  ))}
                </dl>
              </Reveal>
            </div>
          </div>
        </section>

        <div className="hairline wrap mt-16" />
        <Thesis thesis={site.thesis} />
        <div className="hairline wrap" />
        <SkillsSection skills={site.skills} />
        <div className="hairline wrap" />
        <HonorsList honors={site.honors} education={site.education} />
      </main>
      <Footer site={site} lastUpdated={lastUpdated()} />
    </>
  );
}
