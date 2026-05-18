import type { Content } from '@/lib/types';

export default function Footer({ content }: { content: Content }) {
  const year = new Date().getFullYear();
  return (
    <footer
      className="mt-12"
      style={{ borderTop: '1px solid rgb(255 255 255 / 0.08)' }}
    >
      <div className="wrap py-12 md:py-16">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-12 md:gap-10">
          <div className="md:col-span-5">
            <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-cyan">
              010 / END
            </div>
            <p className="display-md mt-5 max-w-md text-ink">
              {content.personal.tagline}
            </p>
          </div>
          <div className="md:col-span-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-mute">
              Reach
            </div>
            <ul className="mt-3 space-y-2 text-ink">
              <li>
                <a
                  href={`mailto:${content.personal.email}`}
                  className="hover:text-cyan"
                >
                  {content.personal.email}
                </a>
              </li>
              {content.personal.linkedin && (
                <li>
                  <a
                    href={content.personal.linkedin}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-cyan"
                  >
                    LinkedIn
                  </a>
                </li>
              )}
              {content.personal.phone && (
                <li className="text-ink-dim">{content.personal.phone}</li>
              )}
            </ul>
          </div>
          <div className="md:col-span-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-mute">
              Site
            </div>
            <ul className="mt-3 space-y-2 text-ink">
              <li>
                <a href="/projects" className="hover:text-cyan">
                  All projects
                </a>
              </li>
              <li>
                <a href="/projects/raven" className="hover:text-cyan">
                  Raven
                </a>
              </li>
              <li>
                <a href="/#contact" className="hover:text-cyan">
                  Contact
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div
          className="mt-12 flex flex-wrap items-center justify-between gap-3 pt-6"
          style={{ borderTop: '1px solid rgb(255 255 255 / 0.06)' }}
        >
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-mute">
            © {year} {content.personal.name}
          </div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-mute">
            Last updated · {content.lastUpdated}
          </div>
        </div>
      </div>
    </footer>
  );
}
