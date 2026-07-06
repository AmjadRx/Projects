import { loadContent, lastUpdated } from '@/lib/content';
import Nav from '@/components/Nav';
import Footer from '@/components/Footer';
import Hero from '@/components/hero/Hero';
import Marquee from '@/components/Marquee';
import StatsBar from '@/components/home/StatsBar';
import Thesis from '@/components/home/Thesis';
import FeaturedProjects from '@/components/home/FeaturedProjects';
import About from '@/components/home/About';
import SkillsSection from '@/components/home/SkillsSection';
import ExperienceTimeline from '@/components/home/ExperienceTimeline';
import HonorsList from '@/components/home/HonorsList';
import ContactSection from '@/components/home/ContactSection';

export const dynamic = 'force-static';

export default function Home() {
  const { site, projects } = loadContent();
  const keywords = site.skills.groups.flatMap((g) => g.items).slice(0, 18);

  const personJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: site.personal.name,
    email: `mailto:${site.personal.email}`,
    url: 'https://amjadrehawi.com',
    jobTitle: 'Hardware Engineer',
    affiliation: { '@type': 'CollegeOrUniversity', name: site.personal.school },
    sameAs: site.socialLinks.filter((s) => s.url.startsWith('http')).map((s) => s.url),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(personJsonLd) }}
      />
      <Nav name={site.personal.name} items={site.nav} socials={site.socialLinks} />
      <main>
        <Hero site={site} />
        <Marquee items={keywords} />
        <StatsBar stats={site.stats} />
        <div className="hairline wrap" />
        <Thesis thesis={site.thesis} />
        <FeaturedProjects projects={projects} />
        <div className="hairline wrap" />
        <About about={site.about} />
        <SkillsSection skills={site.skills} />
        <div className="hairline wrap" />
        <ExperienceTimeline experience={site.experience} />
        <HonorsList honors={site.honors} education={site.education} />
        <ContactSection site={site} />
      </main>
      <Footer site={site} lastUpdated={lastUpdated()} />
    </>
  );
}
