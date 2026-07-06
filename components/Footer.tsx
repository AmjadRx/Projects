import Link from 'next/link';
import type { Site } from '@/lib/types';
import LinkIcon from './LinkIcon';

export default function Footer({ site, lastUpdated }: { site: Site; lastUpdated: string }) {
  const year = new Date().getFullYear();
  const socials = site.socialLinks.filter((s) => s.showInFooter);
  return (
    <footer style={{ borderTop: '1px solid var(--line)' }}>
      <div className="wrap flex flex-col gap-10 py-14 md:py-16">
        <div className="flex flex-col justify-between gap-8 md:flex-row md:items-end">
          <div>
            <p className="display-3 max-w-md">{site.personal.tagline}</p>
            <div className="mt-5 flex flex-wrap items-center gap-2">
              {socials.map((s) => (
                <a
                  key={s.id}
                  href={s.url}
                  target={s.url.startsWith('http') ? '_blank' : undefined}
                  rel={s.url.startsWith('http') ? 'noopener noreferrer' : undefined}
                  className="pill transition-colors hover:border-accent/60 hover:text-accent"
                >
                  <LinkIcon icon={s.icon} size={13} />
                  {s.label}
                </a>
              ))}
            </div>
          </div>
          <nav className="flex flex-col gap-2 md:items-end" aria-label="Footer">
            {site.nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-sm text-ink-dim transition-colors hover:text-ink"
              >
                {item.label}
              </Link>
            ))}
            <Link href="/admin" className="text-sm text-ink-mute transition-colors hover:text-accent">
              Admin
            </Link>
          </nav>
        </div>
        <div
          className="flex flex-wrap items-center justify-between gap-3 pt-6"
          style={{ borderTop: '1px solid var(--line)' }}
        >
          <span className="kicker">© {year} {site.personal.name}</span>
          <span className="kicker">Last updated {lastUpdated}</span>
        </div>
      </div>
    </footer>
  );
}
