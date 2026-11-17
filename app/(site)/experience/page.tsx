import type { Metadata } from 'next';
import MediaImage from '@/components/ui/MediaImage';
import { hasText } from '@/lib/format';
import { resolveMedia } from '@/lib/media-server';
import { pageMetadata } from '@/lib/meta';
import { navLabel, siteData } from '@/lib/site';

export function generateMetadata(): Metadata {
  const { site } = siteData();
  return pageMetadata(site, { title: navLabel(site, '/experience', 'Experience'), description: site.seo.description, path: '/experience' });
}

/** The timeline of roles with bullets (ARCHITECTURE.md 5). Each role is an h2 (docs/V3_PLAN.md D-67). */
export default function ExperiencePage() {
  const { site } = siteData();
  const roles = site.experience.filter((role) => hasText(role.role) || hasText(role.company));
  return (
    <div className="wrap py-12 md:py-16">
      <h1 className="display-2">{navLabel(site, '/experience', 'Experience')}</h1>
      <ol className="mt-10 flex flex-col">
        {roles.map((role, i) => {
          const logo = resolveMedia(role.logo);
          const bullets = role.bullets.filter(hasText);
          // The role is the heading; with no role the company takes its place and is not repeated.
          const heading = hasText(role.role) ? role.role : role.company;
          const company = hasText(role.role) && hasText(role.company) ? role.company : '';
          return (
            <li key={`${role.company}-${role.role}-${i}`} className="grid gap-4 border-t border-line py-8 md:grid-cols-[12rem_1fr] md:gap-8">
              {hasText(role.dates) && <p className="data text-sm text-ink-mute">{role.dates}</p>}
              <article className="md:col-start-2">
                <div className="flex items-start gap-4">
                  {logo && (
                    <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-sm bg-well">
                      <MediaImage media={logo} wellAspect={1} sizes="48px" />
                    </div>
                  )}
                  <div>
                    <h2 className="text-xl font-semibold md:text-2xl">{heading}</h2>
                    {(hasText(company) || hasText(role.location)) && (
                      <p className="mt-1 text-ink">
                        {company}
                        {hasText(role.location) && (
                          <span className="text-ink-mute">{hasText(company) ? `, ${role.location}` : role.location}</span>
                        )}
                      </p>
                    )}
                  </div>
                </div>
                {bullets.length > 0 && (
                  <ul className="prose-md mt-4 list-disc space-y-2 pl-5">
                    {bullets.map((bullet, b) => (
                      <li key={b}>{bullet}</li>
                    ))}
                  </ul>
                )}
              </article>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
