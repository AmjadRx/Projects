import type { Metadata } from 'next';
import { loadContent, lastUpdated } from '@/lib/content';
import Nav from '@/components/Nav';
import Footer from '@/components/Footer';
import Reveal from '@/components/Reveal';
import ExperienceTimeline from '@/components/home/ExperienceTimeline';
import StatsBar from '@/components/home/StatsBar';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'Experience',
  description:
    'Roles across STMicroelectronics, Bronco Racing FSAE, and more: high-voltage batteries, motor control, embedded firmware.',
};

export default function ExperiencePage() {
  const { site } = loadContent();
  return (
    <>
      <Nav name={site.personal.name} items={site.nav} socials={site.socialLinks} />
      <main className="pb-12 pt-28 md:pt-40">
        <section className="wrap">
          <Reveal>
            <p className="kicker">Experience</p>
            <h1 className="display-1 mt-5">Where I have worked</h1>
            <p className="body-lg mt-5 max-w-2xl">
              The same stack across every role: high-voltage power, motor control, embedded
              firmware, and the systems craft to ship them together.
            </p>
          </Reveal>
        </section>
        <StatsBar stats={site.stats} />
        <div className="hairline wrap" />
        <ExperienceTimeline experience={site.experience} showHeader={false} />
      </main>
      <Footer site={site} lastUpdated={lastUpdated()} />
    </>
  );
}
