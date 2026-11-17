import Link from 'next/link';
import { ArrowRight, Mail } from 'lucide-react';
import ProjectCard from '@/components/projects/ProjectCard';
import MediaImage from '@/components/ui/MediaImage';
import { hasText, statText } from '@/lib/format';
import type { LinkResolver } from '@/lib/links';
import { resolveMedia } from '@/lib/media-server';
import { navLabel } from '@/lib/site';
import { UI } from '@/lib/strings';
import type { Project, Site } from '@/lib/types';

/**
 * The home page sections after the hero, in the order of ARCHITECTURE.md 5: readouts, thesis,
 * now, selected work, about teaser, tools strip, contact call. Nothing animates in this phase:
 * readouts print their final values.
 */

export function Readouts({ stats, resolveLink }: { stats: Site['stats']; resolveLink: LinkResolver }) {
  const shown = stats.filter((s) => hasText(s.value) && hasText(s.label));
  if (shown.length === 0) return null;
  return (
    <section aria-labelledby="readouts-title" className="wrap">
      <h2 id="readouts-title" className="sr-only">
        {UI.home.readouts}
      </h2>
      <ul className="grid grid-cols-2 gap-px overflow-hidden rounded-sm border border-line bg-[var(--line)] md:grid-cols-3 lg:grid-cols-6">
        {shown.map((stat, i) => {
          const target = resolveLink(stat.proof);
          const body = (
            <>
              <span className="data block text-3xl text-ink md:text-4xl">{statText(stat)}</span>
              <span className="mt-2 block text-sm text-ink-dim">{stat.label}</span>
            </>
          );
          return (
            <li key={`${stat.label}-${i}`} className="bg-surface">
              {target && !target.external ? (
                <Link href={target.href} className="block h-full p-5 hover:bg-surface-2">
                  {body}
                </Link>
              ) : (
                <div className="h-full p-5">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function Thesis({ thesis }: { thesis: Site['thesis'] }) {
  const pillars = thesis.pillars.filter((p) => hasText(p.title));
  if (!hasText(thesis.headline) && pillars.length === 0) return null;
  return (
    <section aria-labelledby={hasText(thesis.headline) ? 'thesis-title' : undefined} className="wrap section mt-16">
      {hasText(thesis.kicker) && <p className="kicker mb-3">{thesis.kicker}</p>}
      {hasText(thesis.headline) && (
        <h2 id="thesis-title" className="display-3 max-w-3xl">
          {thesis.headline}
        </h2>
      )}
      {hasText(thesis.body) && <p className="body-lg mt-5 max-w-[68ch]">{thesis.body}</p>}
      {pillars.length > 0 && (
        <ul className="mt-10 grid gap-px overflow-hidden rounded-sm border border-line bg-[var(--line)] md:grid-cols-2 lg:grid-cols-4">
          {pillars.map((pillar, i) => (
            <li key={`${pillar.title}-${i}`} className="flex flex-col gap-2 bg-surface p-5">
              {hasText(pillar.k) && <span className="data text-sm text-ink-mute">{pillar.k}</span>}
              <h3 className="text-lg font-semibold">{pillar.title}</h3>
              {hasText(pillar.desc) && <p className="text-ink-dim">{pillar.desc}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function NowList({ now, resolveLink }: { now: Site['now']; resolveLink: LinkResolver }) {
  const items = now.filter((item) => hasText(item.label));
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="now-title" className="wrap section">
      <h2 id="now-title" className="section-title">
        {UI.home.now}
      </h2>
      <ul className="mt-6 flex max-w-3xl flex-col">
        {items.map((item, i) => {
          const target = resolveLink(item.href);
          return (
            <li key={`${item.label}-${i}`} className="border-t border-line py-3 text-base md:text-lg">
              {target && !target.external ? (
                <Link href={target.href} className="text-link inline-flex min-h-[44px] items-center">
                  {item.label}
                </Link>
              ) : target ? (
                <a href={target.href} rel="noopener noreferrer" className="text-link inline-flex min-h-[44px] items-center">
                  {item.label}
                </a>
              ) : (
                <span className="inline-flex min-h-[44px] items-center text-ink">{item.label}</span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function SelectedWork({ projects }: { projects: Project[] }) {
  if (projects.length === 0) return null;
  const featured = projects.filter((p) => p.featured);
  const rest = projects.filter((p) => !p.featured);
  return (
    <section aria-labelledby="work-title" className="wrap section" id="work">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h2 id="work-title" className="section-title">
          {UI.home.selectedWork}
        </h2>
        <Link href="/projects" className="text-link inline-flex min-h-[44px] items-center gap-2">
          {UI.home.allProjects}
          <ArrowRight size={16} aria-hidden />
        </Link>
      </div>
      <div className="mt-8 grid gap-6 md:grid-cols-2">
        {featured.map((project) => (
          <ProjectCard key={project.slug} project={project} headingLevel={3} featured />
        ))}
        {rest.map((project) => (
          <ProjectCard key={project.slug} project={project} headingLevel={3} />
        ))}
      </div>
    </section>
  );
}

export function AboutTeaser({ site }: { site: Site }) {
  const { about, personal } = site;
  const first = about.paragraphs.find(hasText);
  const photo = resolveMedia(personal.photo);
  if (!hasText(about.heading) && !first) return null;
  return (
    <section aria-labelledby="about-title" className="wrap section grid gap-10 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] md:items-center">
      <div>
        <h2 id="about-title" className="section-title">
          {hasText(about.heading) ? about.heading : navLabel(site, '/about', 'About')}
        </h2>
        {first && <p className="body-lg mt-5 max-w-[66ch]">{first}</p>}
        <Link href="/about" className="text-link mt-6 inline-flex min-h-[44px] items-center gap-2">
          {UI.home.moreAbout}
          <ArrowRight size={16} aria-hidden />
        </Link>
      </div>
      {photo && (
        <div className="mx-auto w-full max-w-xs md:justify-self-end">
          <div
            className="relative w-full overflow-hidden rounded-sm bg-well"
            style={{ aspectRatio: photo.width && photo.height ? `${photo.width} / ${photo.height}` : '3 / 4' }}
          >
            <MediaImage media={photo} wellAspect={photo.width && photo.height ? photo.width / photo.height : 3 / 4} sizes="(min-width: 768px) 320px, 80vw" />
          </div>
        </div>
      )}
    </section>
  );
}

/** The tools strip: every skill label in content order, labels only (docs/V3_PLAN.md Q-41). Static in this phase. */
export function ToolsStrip({ skills }: { skills: Site['skills'] }) {
  const labels = skills.groups.flatMap((g) => g.items.map((i) => i.label)).filter(hasText);
  if (labels.length === 0) return null;
  return (
    <section aria-labelledby="tools-title" className="wrap section">
      <h2 id="tools-title" className="section-title">
        {UI.home.tools}
      </h2>
      <ul className="mt-6 flex flex-wrap gap-x-2 gap-y-2 text-ink-dim">
        {labels.map((label, i) => (
          <li key={`${label}-${i}`} className="inline-flex items-center">
            {i > 0 && (
              <span aria-hidden className="mr-2 text-ink-mute">
                ·
              </span>
            )}
            {label}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ContactCall({ site }: { site: Site }) {
  const { contact, personal } = site;
  if (!hasText(contact.heading) && !hasText(personal.email)) return null;
  return (
    <section aria-labelledby="contact-call-title" className="wrap section">
      <h2 id="contact-call-title" className="display-3 max-w-3xl">
        {hasText(contact.heading) ? contact.heading : navLabel(site, '/contact', 'Contact')}
      </h2>
      {hasText(contact.body) && <p className="body-lg mt-5 max-w-[66ch]">{contact.body}</p>}
      <div className="mt-8 flex flex-wrap items-center gap-4">
        {hasText(personal.email) && (
          <a href={`mailto:${personal.email}`} className="btn-primary">
            <Mail size={16} aria-hidden />
            {UI.contact.emailMe}
          </a>
        )}
        <Link href="/contact" className="text-link inline-flex min-h-[44px] items-center gap-2">
          {UI.home.contactPage}
          <ArrowRight size={16} aria-hidden />
        </Link>
      </div>
    </section>
  );
}
