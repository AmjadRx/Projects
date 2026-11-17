import type { Metadata } from 'next';
import BillOfMaterials from '@/components/about/BillOfMaterials';
import ImageZoom from '@/components/viewers/image/ImageZoom';
import { gpaText, hasText, isGpaFact } from '@/lib/format';
import { resolveMedia } from '@/lib/media-server';
import { pageMetadata } from '@/lib/meta';
import { navLabel, siteData } from '@/lib/site';
import { UI } from '@/lib/strings';

export function generateMetadata(): Metadata {
  const { site } = siteData();
  return pageMetadata(site, { title: navLabel(site, '/about', 'About'), description: site.seo.description, path: '/about' });
}

/** Heading, paragraphs, facts, headshot; skills as a bill of materials; education; honors (ARCHITECTURE.md 5). */
export default function AboutPage() {
  const { site, projects } = siteData();
  const { about, personal } = site;
  const headshot = resolveMedia(about.headshot);
  const gpa = gpaText(personal);
  // A GPA fact prints through the GPA helper, label and value together, so an empty GPA hides
  // it (docs/V3_PLAN.md D-08, D-14).
  const facts = about.facts.filter((fact) =>
    isGpaFact(fact, personal) ? gpa !== '' : hasText(fact.label) && hasText(fact.value),
  );
  const paragraphs = about.paragraphs.filter(hasText);
  const education = site.education.filter((e) => hasText(e.school) || hasText(e.degree));
  const honors = site.honors.filter((h) => hasText(h.title));

  return (
    <div className="wrap py-12 md:py-16">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:items-start">
        <div>
          <h1 className="display-2">{hasText(about.heading) ? about.heading : navLabel(site, '/about', 'About')}</h1>
          <div className="mt-6 flex max-w-[68ch] flex-col gap-4 text-base text-ink-dim md:text-lg">
            {paragraphs.map((paragraph, i) => (
              <p key={i}>{paragraph}</p>
            ))}
          </div>
          {facts.length > 0 && (
            <dl aria-label={UI.about.facts} className="mt-8 grid gap-px overflow-hidden rounded-sm border border-line bg-[var(--line)] sm:grid-cols-2">
              {facts.map((fact, i) => (
                <div key={`${fact.label}-${i}`} className="flex flex-col gap-1 bg-surface p-4">
                  <dt className="text-sm text-ink-mute">{isGpaFact(fact, personal) ? personal.gpaLabel.trim() : fact.label}</dt>{' '}
                  <dd className="text-ink">{isGpaFact(fact, personal) ? personal.gpa.trim() : fact.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
        {headshot && (
          <div className="mx-auto w-full max-w-sm lg:mx-0 lg:justify-self-end">
            <ImageZoom media={headshot} fit="natural" sizes="(min-width: 1024px) 384px, 90vw" priority />
          </div>
        )}
      </div>

      <section className="section mt-16" aria-labelledby="skills-title">
        <h2 id="skills-title" className="section-title">
          {UI.about.skills}
        </h2>
        <p className="mt-2 text-sm text-ink-mute">{UI.about.skillsCaption}</p>
        <div className="mt-8">
          <BillOfMaterials skills={site.skills} projects={projects} />
        </div>
      </section>

      {education.length > 0 && (
        <section className="section" aria-labelledby="education-title">
          <h2 id="education-title" className="section-title">
            {UI.about.education}
          </h2>
          <ul className="mt-8 flex flex-col gap-8">
            {education.map((entry, i) => (
              <li key={`${entry.school}-${i}`} className="grid gap-1 md:grid-cols-[1fr_auto] md:gap-x-8">
                <h3 className="text-lg font-semibold">{hasText(entry.school) ? entry.school : entry.degree}</h3>
                {hasText(entry.dates) && <p className="data text-sm text-ink-mute md:row-start-1 md:col-start-2">{entry.dates}</p>}
                {hasText(entry.school) && hasText(entry.degree) && <p className="text-ink">{entry.degree}</p>}
                {hasText(entry.details) && <p className="text-ink-dim">{entry.details}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {honors.length > 0 && (
        <section className="section" aria-labelledby="honors-title">
          <h2 id="honors-title" className="section-title">
            {UI.about.honors}
          </h2>
          <ul className="mt-8 flex flex-col gap-6">
            {honors.map((honor, i) => (
              <li key={`${honor.title}-${i}`} className="grid gap-1 md:grid-cols-[6rem_1fr] md:gap-x-6">
                {hasText(honor.year) && <p className="data text-sm text-ink-mute">{honor.year}</p>}
                <div className="md:col-start-2">
                  <p className="font-semibold text-ink">{honor.title}</p>
                  {hasText(honor.note) && <p className="mt-1 text-ink-dim">{honor.note}</p>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
