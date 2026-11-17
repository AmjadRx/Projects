import type { Metadata } from 'next';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import { loadContent, lastUpdated } from '@/lib/legacy/content';
import type { LogEntry } from '@/lib/legacy/types';
import Nav from '@/components/Nav';
import Footer from '@/components/Footer';

export const dynamic = 'force-static';

// Interim page so the seed's nav link resolves. Phase 7 replaces it with the revision table of
// ARCHITECTURE.md section 5. Every word on it comes from the seed.

function pageTitle(): string {
  const { site } = loadContent();
  return site.nav.find((item) => item.href === '/log')?.label ?? site.personal.name;
}

export function generateMetadata(): Metadata {
  return { title: pageTitle() };
}

export default function LogPage() {
  const { site, projects } = loadContent();
  const entries = projects
    .flatMap((project) =>
      project.blocks
        .filter((block) => block.type === 'log')
        .flatMap((block) => (block as { entries: LogEntry[] }).entries)
        .map((entry) => ({ entry, project })),
    )
    .sort((a, b) => b.entry.date.localeCompare(a.entry.date) || a.project.order - b.project.order);

  return (
    <>
      <Nav name={site.personal.name} items={site.nav} socials={site.socialLinks} />
      <main className="pb-12 pt-28 md:pt-40">
        <section className="wrap">
          <h1 className="display-1">{pageTitle()}</h1>
          <ol className="mt-12 flex flex-col gap-10">
            {entries.map(({ entry, project }, i) => (
              <li key={`${project.slug}-${i}`} className="border-t border-line pt-6">
                <p className="font-mono text-sm text-ink-mute">
                  {entry.date} ·{' '}
                  <Link href={`/projects/${project.slug}`} className="hover:text-accent">
                    {project.title}
                  </Link>
                </p>
                <h2 className="mt-2 text-xl font-semibold text-ink">{entry.title}</h2>
                <div className="prose-md mt-3">
                  <ReactMarkdown>{entry.md}</ReactMarkdown>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </main>
      <Footer site={site} lastUpdated={lastUpdated()} />
    </>
  );
}
