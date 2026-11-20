import type { Metadata } from 'next';
import Headshot from '@/components/about/Headshot';
import BomTable, { hasSkills } from '@/components/sheet/BomTable';
import Glass from '@/components/sheet/Glass';
import { gpaText, hasText, isGpaFact } from '@/lib/format';
import { resolveMedia } from '@/lib/media-server';
import { pageMetadata } from '@/lib/meta';
import { homeMetaImage } from '@/lib/og/meta';
import { navLabel, siteData } from '@/lib/site';
import { UI } from '@/lib/strings';

export function generateMetadata(): Metadata {
  const { site } = siteData();
  return pageMetadata(site, { title: navLabel(site, '/about', 'About'), description: site.seo.description, path: '/about', image: homeMetaImage(site) });
}

/** The headshot's width: four columns of twelve from 1024 px, a 240 px figure below. */
const HEADSHOT_SIZES = '(min-width: 1024px) 384px, 240px';

/**
 * Heading, paragraphs, facts, headshot; skills as a bill of materials; education; honors
 * (ARCHITECTURE.md 5), laid out as the About board: the paragraphs on glass beside the headshot
 * and the facts from 1024 px, then the three sections.
 */
export default function AboutPage() {
  const { site, projects, resolveLink } = siteData();
  const { about, personal } = site;
  const headshot = resolveMedia(about.headshot);
  const still = headshot ? (headshot.kind === 'image' ? headshot.file.src : headshot.poster?.src) : undefined;
  const gpa = gpaText(personal);
  // A GPA fact prints through the GPA helper, label and value together, so an empty GPA hides
  // it (docs/V3_PLAN.md D-08, D-14).
  const facts = about.facts.filter((fact) =>
    isGpaFact(fact, personal) ? gpa !== '' : hasText(fact.label) && hasText(fact.value),
  );
  const paragraphs = about.paragraphs.filter(hasText);
  const education = site.education.filter((e) => hasText(e.school) || hasText(e.degree));
  const honors = site.honors.filter((h) => hasText(h.title));
  const showPhoto = headshot !== null && hasText(still);
  const hasSide = showPhoto || facts.length > 0;

  return (
    <div className="hm-wrap st-page">
      <header className="st-head">
        <h1 className="st-title">{hasText(about.heading) ? about.heading : navLabel(site, '/about', 'About')}</h1>
      </header>

      {paragraphs.length > 0 || hasSide ? (
        <div className="st-about">
          {paragraphs.length > 0 ? (
            <Glass className="st-about__text">
              {paragraphs.map((paragraph, i) => (
                <p key={i} className="hm-copy">
                  {paragraph}
                </p>
              ))}
            </Glass>
          ) : null}
          {hasSide ? (
            <div className="st-about__side">
              {showPhoto && headshot && still ? (
                <Headshot
                  media={headshot}
                  src={still}
                  alt={headshot.alt}
                  focal={headshot.focal}
                  sizes={HEADSHOT_SIZES}
                  priority
                  labels={{
                    didNotLoad: UI.placeholder.didNotLoad,
                    tryAgain: UI.placeholder.tryAgain,
                    openImage: UI.viewers.image.open,
                  }}
                />
              ) : null}
              {facts.length > 0 ? (
                <Glass pad={false} className="st-facts">
                  <dl aria-label={UI.about.facts} className="st-facts__list">
                    {facts.map((fact, i) => (
                      <div key={`${fact.label}-${i}`} className="st-facts__row">
                        <dt>{isGpaFact(fact, personal) ? personal.gpaLabel.trim() : fact.label}</dt>{' '}
                        <dd>{isGpaFact(fact, personal) ? personal.gpa.trim() : fact.value}</dd>
                      </div>
                    ))}
                  </dl>
                </Glass>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {hasSkills(site.skills) ? (
        <section className="st-sec" aria-labelledby="skills-title">
          <h2 id="skills-title" className="hm-h2">
            {UI.about.skills}
          </h2>
          <Glass>
            <BomTable skills={site.skills} projects={projects} resolveLink={resolveLink} />
          </Glass>
        </section>
      ) : null}

      {education.length > 0 ? (
        <section className="st-sec" aria-labelledby="education-title">
          <h2 id="education-title" className="hm-h2">
            {UI.about.education}
          </h2>
          <ul className="st-edu">
            {education.map((entry, i) => (
              <li key={`${entry.school}-${i}`} className="ar-glass st-edu__item">
                {hasText(entry.dates) ? <p className="st-edu__dates">{entry.dates}</p> : null}
                <h3 className="st-edu__school">{hasText(entry.school) ? entry.school : entry.degree}</h3>
                {hasText(entry.school) && hasText(entry.degree) ? <p className="st-edu__degree">{entry.degree}</p> : null}
                {hasText(entry.details) ? <p className="st-edu__details">{entry.details}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {honors.length > 0 ? (
        <section className="st-sec" aria-labelledby="honors-title">
          <h2 id="honors-title" className="hm-h2">
            {UI.about.honors}
          </h2>
          <Glass as="ol" pad={false} className="st-hon">
            {honors.map((honor, i) => (
              <li key={`${honor.title}-${i}`}>
                {hasText(honor.year) ? <p className="st-hon__year">{honor.year}</p> : null}
                <div className="st-hon__body">
                  <p className="st-hon__title">{honor.title}</p>
                  {hasText(honor.note) ? <p className="st-hon__note">{honor.note}</p> : null}
                </div>
              </li>
            ))}
          </Glass>
        </section>
      ) : null}
    </div>
  );
}
