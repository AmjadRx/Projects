import Nav from '@/components/Nav';
import Footer from '@/components/Footer';
import Reveal from '@/components/Reveal';
import Hero from '@/components/sections/Hero';
import Stats from '@/components/sections/Stats';
import BrandThesisSection from '@/components/sections/BrandThesis';
import AboutSection from '@/components/sections/About';
import ProjectsGrid from '@/components/sections/Projects';
import SkillsSection from '@/components/sections/Skills';
import ExperienceSection from '@/components/sections/Experience';
import HonorsSection from '@/components/sections/Honors';
import ContactSection from '@/components/sections/Contact';
import { loadContent } from '@/lib/content';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

export default async function Home() {
  const content = await loadContent();
  return (
    <>
      <Nav />
      <main>
        <Hero personal={content.personal} />
        <Reveal><Stats stats={content.stats} /></Reveal>
        <Reveal><BrandThesisSection thesis={content.brandThesis} /></Reveal>
        <Reveal><AboutSection about={content.about} /></Reveal>
        <Reveal><ProjectsGrid projects={content.projects} /></Reveal>
        <Reveal><SkillsSection skills={content.skills} /></Reveal>
        <Reveal><ExperienceSection experience={content.experience} /></Reveal>
        <Reveal><HonorsSection honors={content.honors} /></Reveal>
        <Reveal><ContactSection contact={content.contact} personal={content.personal} /></Reveal>
      </main>
      <Footer content={content} />
    </>
  );
}
