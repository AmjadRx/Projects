import Link from 'next/link';
import { ArrowRight, ArrowUpRight, Mail } from 'lucide-react';
import Button from '@/components/sheet/Button';
import CoverImage from '@/components/sheet/CoverImage';
import Glass from '@/components/sheet/Glass';
import Icon from '@/components/sheet/Icon';
import { linkGlyph } from '@/components/sheet/linkGlyph';
import ProjectCard, { CARD_SIZES } from '@/components/sheet/ProjectCard';
import ReadoutRow from '@/components/sheet/Readout';
import TextLink from '@/components/sheet/TextLink';
import FeaturedStrip from './FeaturedStrip';
import TickerStrip from './TickerStrip';
import { hasText, statusText } from '@/lib/format';
import type { LinkResolver } from '@/lib/links';
import { resolveMedia } from '@/lib/media-server';
import { navLabel, socialLinksFor } from '@/lib/site';
import { UI } from '@/lib/strings';
import type { Project, Site } from '@/lib/types';
import { cn } from '@/lib/utils';

/**
 * The home page sections after the hero, in the order of ARCHITECTURE.md 5 and the canvas's
 * Main board: readouts, thesis, now, selected work, about teaser, tools strip, contact call.
 * Three pieces move, each a small client leaf whose Motion+ code loads on demand as it nears the
 * view (DESIGN_DIRECTION.md 6.4): the readouts count up once (AnimateNumber), the featured cards
 * are a Carousel on a phone, and the tools strip is a Ticker from 768 px. The server draws each one
 * final and still, which is what stays without scripts and under reduced motion.
 * Each section names itself with its heading's id (the build tests read the ids and their order).
 */

export function Readouts({
  stats,
  resolveLink,
  projects,
}: {
  stats: Site['stats'];
  resolveLink: LinkResolver;
  projects: Project[];
}) {
  const shown = stats.filter((s) => hasText(s.value) && hasText(s.label));
  if (shown.length === 0) return null;
  return (
    <section className="hm-readouts" aria-labelledby="readouts-title">
      <div className="hm-wrap">
        <h2 id="readouts-title" className="ar-sr">
          {UI.home.readouts}
        </h2>
        <ReadoutRow stats={shown} resolveLink={resolveLink} projects={projects} count />
      </div>
    </section>
  );
}

/** The thesis: the headline (a section statement) beside its paragraph on glass, then the four pillars. */
export function Thesis({ thesis }: { thesis: Site['thesis'] }) {
  const pillars = thesis.pillars.filter((p) => hasText(p.title));
  const headed = hasText(thesis.headline);
  const hasHead = headed || hasText(thesis.kicker);
  if (!headed && !hasText(thesis.body) && pillars.length === 0) return null;
  return (
    <section className="hm-sec hm-thesis" aria-labelledby={headed ? 'thesis-title' : undefined}>
      <div className="hm-wrap hm-thesis__grid">
        {hasHead ? (
          <div className="hm-thesis__head">
            {hasText(thesis.kicker) ? <p className="hm-label">{thesis.kicker}</p> : null}
            {headed ? (
              <h2 className="hm-h1" id="thesis-title">
                {thesis.headline}
              </h2>
            ) : null}
          </div>
        ) : null}
        {hasText(thesis.body) ? (
          <Glass className={cn('hm-thesis__body', !hasHead && 'hm-thesis__body--solo')}>
            <p className="hm-copy">{thesis.body}</p>
          </Glass>
        ) : null}
        {pillars.length > 0 ? (
          <ul className="hm-pillars">
            {pillars.map((pillar, i) => (
              <li key={`${pillar.title}-${i}`} className="ar-glass hm-pillar">
                <h3 className="hm-pillar__head">
                  <span>{pillar.title}</span>
                </h3>
                {hasText(pillar.desc) ? <p className="hm-pillar__d">{pillar.desc}</p> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}

/** Now: a short list on glass, each row a link when its address leads to a page that is shown. */
export function NowList({ now, resolveLink }: { now: Site['now']; resolveLink: LinkResolver }) {
  const items = now.filter((item) => hasText(item.label));
  if (items.length === 0) return null;
  return (
    <section className="hm-sec hm-now" aria-labelledby="now-title">
      <div className="hm-wrap hm-now__grid">
        <h2 className="hm-label hm-now__label" id="now-title">
          {UI.home.now}
        </h2>
        <ul className="hm-now__list ar-glass">
          {items.map((item, i) => {
            const target = resolveLink(item.href);
            const body = (
              <>
                <span className="hm-now__mark" aria-hidden="true" />
                <span className="hm-now__text">{item.label}</span>
                {target ? (
                  <span className="hm-now__go" aria-hidden="true">
                    <Icon icon={target.external ? ArrowUpRight : ArrowRight} size={18} />
                  </span>
                ) : null}
              </>
            );
            return (
              <li key={`${item.label}-${i}`}>
                {target && !target.external && target.href.startsWith('/') ? (
                  <Link href={target.href} className="hm-now__row">
                    {body}
                  </Link>
                ) : target ? (
                  <a href={target.href} rel={target.external ? 'noopener noreferrer' : undefined} className="hm-now__row">
                    {body}
                  </a>
                ) : (
                  <span className="hm-now__row">{body}</span>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

/** Sheet numbers on the index read as two digits, as on the drawing list ("05"). */
function sheetNumber(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Selected work (the canvas's default, option B): the featured projects as cards, two across from
 * 768 px and a swipe strip on phones (FeaturedStrip, a Motion+ Carousel once it nears the view),
 * then the other projects as an index on glass (sheet number, title, pitch, domain, status,
 * maturity label), and the link to all projects. The index draws no ramp: it is not a card, and
 * the maturity reads as the content's label (docs/V3_PLAN.md Q-12).
 */
export function SelectedWork({ projects }: { projects: Project[] }) {
  if (projects.length === 0) return null;
  const sheets = new Map(projects.map((p, i) => [p.slug, i + 1]));
  const featured = projects.filter((p) => p.featured);
  const rest = projects.filter((p) => !p.featured);
  return (
    <section className="hm-sec hm-work" id="work" aria-labelledby="work-title">
      <div className="hm-wrap">
        <div className="hm-head">
          <h2 className="hm-h2" id="work-title">
            {UI.home.selectedWork}
          </h2>
          <TextLink href="/projects" variant="standalone">
            {UI.home.allProjects}
          </TextLink>
        </div>
        {featured.length > 0 ? (
          <FeaturedStrip
            id="featured-work"
            items={featured.map((project) => (
              <ProjectCard key={project.slug} project={project} headingLevel={3} sizes={CARD_SIZES.regular} />
            ))}
            labels={UI.home.featuredStrip}
          />
        ) : null}
        {rest.length > 0 ? (
          <div className={cn('hm-more', featured.length === 0 && 'hm-more--first')}>
            <div className="hm-index ar-glass">
              <div className="hm-index__head" aria-hidden="true">
                <span>{UI.home.index.sheet}</span>
                <span>{UI.home.index.project}</span>
                <span>{UI.home.index.domain}</span>
                <span>{UI.home.index.status}</span>
                <span>{UI.home.index.maturity}</span>
              </div>
              <ol className="hm-index__list" aria-label={UI.projects.moreProjects}>
                {rest.map((project) => {
                  const maturity = project.maturity && hasText(project.maturity.label) ? project.maturity.label : '';
                  const status = statusText(project);
                  const showStatus = hasText(status) && status.trim() !== maturity.trim();
                  return (
                    <li key={project.slug}>
                      <Link href={`/projects/${project.slug}`} className="hm-index__row">
                        <span className="hm-index__n">{sheetNumber(sheets.get(project.slug) ?? 0)}</span>
                        <span className="hm-index__t">{project.title}</span>
                        {hasText(project.pitch) ? <span className="hm-index__p">{project.pitch}</span> : null}
                        {hasText(project.domain) ? <span className="hm-index__d">{project.domain}</span> : null}
                        {showStatus ? <span className="hm-index__s">{status}</span> : null}
                        {maturity ? <span className="hm-index__m">{maturity}</span> : null}
                        <span className="hm-index__go" aria-hidden="true">
                          <Icon icon={ArrowRight} size={18} />
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ol>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

/** The about teaser: the headshot, the about heading, the first paragraph on glass, and the link to /about. */
export function AboutTeaser({ site }: { site: Site }) {
  const { about, personal } = site;
  const first = about.paragraphs.find(hasText);
  const photo = resolveMedia(personal.photo);
  const still = photo ? (photo.kind === 'image' ? photo.file.src : photo.poster?.src) : undefined;
  if (!hasText(about.heading) && !first) return null;
  return (
    <section className="hm-sec hm-about" aria-labelledby="about-title">
      <div className="hm-wrap hm-about__grid">
        {photo && still ? (
          <figure className="hm-about__photo">
            <CoverImage
              src={still}
              alt={photo.alt}
              focal={photo.focal}
              sizes="(min-width: 1024px) 384px, 220px"
              labels={{ didNotLoad: UI.placeholder.didNotLoad, tryAgain: UI.placeholder.tryAgain }}
            />
          </figure>
        ) : null}
        <div className={cn('hm-about__text', !(photo && still) && 'hm-about__text--solo')}>
          <h2 className="hm-h2" id="about-title">
            {hasText(about.heading) ? about.heading : navLabel(site, '/about', 'About')}
          </h2>
          {first ? (
            <Glass>
              <p className="hm-copy">{first}</p>
            </Glass>
          ) : null}
          <TextLink href="/about" variant="standalone">
            {UI.home.moreAbout}
          </TextLink>
        </div>
      </div>
    </section>
  );
}

/**
 * The tools strip (ARCHITECTURE.md 5: "one Ticker"): every skill label in content order
 * (docs/V3_PLAN.md Q-41). The server draws one still row that scrolls sideways, a labelled region
 * that takes focus so the keyboard can scroll it too; from 768 px, with motion allowed, TickerStrip
 * puts the Motion+ Ticker in its place as the strip nears the view (motion sheet 7.7).
 */
export function ToolsStrip({ skills }: { skills: Site['skills'] }) {
  const labels = skills.groups.flatMap((g) => g.items.map((i) => i.label)).filter(hasText);
  if (labels.length === 0) return null;
  return (
    <section className="hm-sec hm-tools">
      <div className="hm-wrap hm-tools__grid">
        <h2 className="hm-label hm-tools__label" id="tools-title">
          {UI.home.tools}
        </h2>
        <TickerStrip labels={labels} labelledBy="tools-title" />
      </div>
    </section>
  );
}

/**
 * The contact call: the heading, then on glass the body, the email as a large link, "Request my
 * resume" (a secondary button that opens an email; no resume file is served), and the contact
 * links (LinkedIn, GitHub, "Book a call", the phone number when it is shown).
 */
export function ContactCall({ site }: { site: Site }) {
  const { contact, personal } = site;
  const email = personal.email.trim();
  const links = socialLinksFor(site, 'contact');
  const resume = contact.resumeRequest;
  const resumeHref =
    resume?.enabled && hasText(email) && hasText(resume.label)
      ? `mailto:${email}?subject=${encodeURIComponent(resume.subject)}&body=${encodeURIComponent(resume.body)}`
      : null;
  if (!hasText(contact.heading) && !hasText(contact.body) && !hasText(email) && links.length === 0) return null;
  const hasPanel = hasText(contact.body) || hasText(email) || resumeHref !== null || links.length > 0;
  return (
    <section className="hm-sec hm-contact" id="contact" aria-labelledby="contact-call-title">
      <div className="hm-wrap hm-contact__grid">
        <div className="hm-contact__head">
          <h2 className="hm-h2 hm-contact__title" id="contact-call-title">
            {hasText(contact.heading) ? contact.heading : navLabel(site, '/contact', 'Contact')}
          </h2>
        </div>
        {hasPanel ? (
          <Glass className="hm-contact__panel">
            {hasText(contact.body) ? <p className="hm-copy">{contact.body}</p> : null}
            {hasText(email) ? (
              <a href={`mailto:${email}`} className="hm-contact__email">
                <Icon icon={Mail} size={28} />
                <span className="hm-contact__addr">{email}</span>
              </a>
            ) : null}
            {resumeHref && resume ? (
              <div className="hm-contact__row">
                <Button variant="secondary" href={resumeHref} icon={Mail}>
                  {resume.label}
                </Button>
              </div>
            ) : null}
            {links.length > 0 ? (
              <ul className="hm-contact__links">
                {links.map((link) => {
                  const glyph = linkGlyph(link.icon, link.url);
                  return (
                    <li key={link.id}>
                      <a href={link.url} rel={/^https?:\/\//i.test(link.url) ? 'noopener noreferrer' : undefined}>
                        {glyph ? <Icon icon={glyph} size={20} /> : null}
                        <span>{link.label}</span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </Glass>
        ) : null}
      </div>
    </section>
  );
}
