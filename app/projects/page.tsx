import type { Metadata } from 'next';
import { loadContent, lastUpdated } from '@/lib/content';
import Nav from '@/components/Nav';
import Footer from '@/components/Footer';
import ProjectsExplorer from '@/components/ProjectsExplorer';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'Projects',
  description:
    'Hardware projects across eVTOL, FSAE tractive systems, motor control, embedded firmware, and product design.',
};

export default function ProjectsPage() {
  const { site, projects } = loadContent();
  return (
    <>
      <Nav name={site.personal.name} items={site.nav} socials={site.socialLinks} />
      <main className="wrap pb-24 pt-28 md:pt-40">
        <p className="kicker">Projects</p>
        <h1 className="display-1 mt-5">The work</h1>
        <p className="body-lg mt-5 max-w-2xl">
          Every project, biggest first: autonomous aircraft, high-voltage tractive systems, motor
          control, embedded builds, and shipped products.
        </p>
        <div className="mt-12">
          <ProjectsExplorer projects={projects} />
        </div>
      </main>
      <Footer site={site} lastUpdated={lastUpdated()} />
    </>
  );
}
