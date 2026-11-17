import Link from 'next/link';
import SiteChrome from '@/components/site/SiteChrome';
import { UI } from '@/lib/strings';

export const metadata = { title: UI.notFound.heading, robots: { index: false, follow: false } };

/** "Sheet not found", centered (the one centered page), with links home and to projects. */
export default function NotFound() {
  return (
    <SiteChrome>
      <div className="wrap flex min-h-[60vh] flex-col items-center justify-center py-24 text-center">
        <h1 className="display-2">{UI.notFound.heading}</h1>
        <p className="body-lg mt-4">{UI.notFound.body}</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/" className="btn-primary">
            {UI.notFound.home}
          </Link>
          <Link href="/projects" className="btn-ghost">
            {UI.notFound.projects}
          </Link>
        </div>
      </div>
    </SiteChrome>
  );
}
