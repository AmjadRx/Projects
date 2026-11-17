import type { Metadata } from 'next';
import BlockRenderer from '@/components/blocks/BlockRenderer';
import { siteData } from '@/lib/site';
import { SAMPLES } from './samples';

/**
 * One of every block on sample files, for testing each viewer on a phone and a computer
 * (ARCHITECTURE.md 14, Phase 3). Not in the sitemap, not indexed, removed before release.
 */
export const metadata: Metadata = {
  title: 'Block samples',
  robots: { index: false, follow: false },
};

export default function BlockSamplesPage() {
  const { resolveLink } = siteData();
  return (
    <div className="wrap py-12 md:py-16">
      <h1 className="display-2">Block samples</h1>
      <p className="body-lg mt-4 max-w-2xl">
        One of every block, on small sample files made for testing. This page is not in the sitemap, is not indexed,
        and is removed before release.
      </p>
      <nav aria-label="Samples" className="mt-8">
        <ul className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-sm">
          {SAMPLES.map((sample) => (
            <li key={sample.id}>
              <a href={`#${sample.id}`} className="text-link inline-flex min-h-[44px] items-center">
                {sample.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      {SAMPLES.map((sample) => (
        <section key={sample.id} id={sample.id} aria-labelledby={`${sample.id}-title`} className="section">
          <h2 id={`${sample.id}-title`} className="font-mono text-lg text-ink">
            {sample.title}
          </h2>
          <p className="mb-8 mt-2 max-w-2xl text-sm text-ink-dim">{sample.note}</p>
          <BlockRenderer blocks={sample.blocks} ctx={{ resolveLink, level: 3, idPrefix: `sample-${sample.id}-` }} />
        </section>
      ))}
    </div>
  );
}
