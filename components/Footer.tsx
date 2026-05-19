import type { Content } from '@/lib/types';
import Link from 'next/link';

export default function Footer({ content }: { content: Content }) {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-line/10 mt-16">
      <div className="wrap py-14 md:py-20">
        <div className="grid grid-cols-1 gap-10 md:grid-cols-12 md:gap-14">
          <div className="md:col-span-5">
            <span className="eyebrow">
              <span className="eyebrow-num">010</span>
              <span className="eyebrow-rule" />
              <span>End</span>
            </span>
            <p className="display-sm text-pretty mt-6 max-w-md text-fg">
              {content.personal.tagline}
            </p>
            <p className="lead mt-4 max-w-md text-[15px]">
              Building Raven — an 8-stage eVTOL roadmap toward a 4-drone autonomous swarm.
            </p>
          </div>
          <div className="md:col-span-3 md:col-start-7">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-fg-mute">
              Reach
            </div>
            <ul className="mt-4 space-y-2 text-fg">
              <li>
                <a href={`mailto:${content.personal.email}`} className="hover:text-accent">
                  {content.personal.email}
                </a>
              </li>
              {content.personal.linkedin && (
                <li>
                  <a
                    href={content.personal.linkedin}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-accent"
                  >
                    LinkedIn
                  </a>
                </li>
              )}
              {content.personal.phone && (
                <li className="text-fg-dim">{content.personal.phone}</li>
              )}
            </ul>
          </div>
          <div className="md:col-span-3">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-fg-mute">
              Site
            </div>
            <ul className="mt-4 space-y-2 text-fg">
              <li>
                <Link href="/projects" className="hover:text-accent">
                  All projects
                </Link>
              </li>
              <li>
                <Link href="/projects/raven" className="hover:text-accent">
                  Raven
                </Link>
              </li>
              <li>
                <Link href="/#contact" className="hover:text-accent">
                  Contact
                </Link>
              </li>
              <li>
                <Link href="/admin" className="text-fg-mute hover:text-accent">
                  Admin
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-14 flex flex-wrap items-center justify-between gap-3 border-t border-line/8 pt-8">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-fg-mute">
            © {year} {content.personal.name}
          </div>
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-fg-soft">
            Last updated · {content.lastUpdated}
          </div>
        </div>
      </div>
    </footer>
  );
}
