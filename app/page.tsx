import Nav from '@/components/Nav';
import Footer from '@/components/Footer';
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
        <Stats stats={content.stats} />
        <BrandThesisSection thesis={content.brandThesis} />
        <AboutSection about={content.about} />
        <ProjectsGrid projects={content.projects} />
        <SkillsSection skills={content.skills} />
        <ExperienceSection experience={content.experience} />
        <HonorsSection honors={content.honors} />
        <ContactSection contact={content.contact} personal={content.personal} />
      </main>
      <Footer content={content} />
    </>
  );
}
