import type { Metadata } from 'next';
import BlockRenderer from '@/components/blocks/BlockRenderer';
import { siteData } from '@/lib/site';
import { cn } from '@/lib/utils';
import styles from './blocks.module.css';
import { SAMPLES } from './samples';

/**
 * One of every block on sample files, for testing each viewer on a phone and a computer
 * (ARCHITECTURE.md 14, Phase 3), laid out like a project body (app/styles/project.css): the title
 * over the wrap, the samples in the main column of eight, the index in the right rail. Not in the
 * sitemap, not indexed, removed before release.
 */
export const metadata: Metadata = {
  title: 'Block samples',
  robots: { index: false, follow: false },
};

export default function BlockSamplesPage() {
  const { resolveLink } = siteData();
  return (
    <>
      <div className="hm-wrap pj-top">
        <header className="pj-head">
          <h1 className="pj-title">Block samples</h1>
          <p className="pj-sub">
            One of every block, on small sample files made for testing. This page is not in the sitemap, is not
            indexed, and is removed before release.
          </p>
        </header>
      </div>
      <div className="hm-wrap pj-grid">
        <div className={styles.samples}>
          {SAMPLES.map((sample) => (
            <section key={sample.id} id={sample.id} aria-labelledby={`${sample.id}-title`} className={styles.sample}>
              <h2 id={`${sample.id}-title`} className="hm-label">
                {sample.title}
              </h2>
              <p className={cn('pj-text', styles.note)}>{sample.note}</p>
              <BlockRenderer blocks={sample.blocks} ctx={{ resolveLink, level: 3, idPrefix: `sample-${sample.id}-` }} />
            </section>
          ))}
        </div>
        <div className={cn('pj-rail', styles.rail)}>
          <nav aria-label="Samples" className={cn('ar-glass ar-glass--pad', styles.index)}>
            <ul className={styles.indexList}>
              {SAMPLES.map((sample) => (
                <li key={sample.id}>
                  <a href={`#${sample.id}`} className="ar-link ar-link--standalone">
                    <span className="ar-link__text">{sample.title}</span>
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </div>
    </>
  );
}
