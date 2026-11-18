import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { hasText } from '@/lib/format';
import { projectSlugOf, type LinkResolver } from '@/lib/links';
import { UI } from '@/lib/strings';
import type { Project, Stat } from '@/lib/types';
import Icon from './Icon';

/**
 * One instrument readout (bundle Readout, bundle.css 13): the value in B612 Mono at 40 to 56 px
 * with its prefix and suffix at half size, the label in Archivo beneath. The value prints exactly
 * as stored ("~50%", "504 V"); the hedge never drops. The tile is the link to the page that proves
 * it, when the proof resolves to a page on this site; otherwise it is plain.
 *
 * The value's digits are a bare text run between the affixes, so the composed value reads as one
 * string ("504 V") in the page text.
 */
export function Readout({
  stat,
  href,
  proofTitle,
}: {
  stat: Pick<Stat, 'prefix' | 'value' | 'suffix' | 'label'>;
  /** The resolved proof address, internal only. */
  href?: string;
  /** The title of the project the link opens, read after the label by screen readers. */
  proofTitle?: string;
}) {
  const body = (
    <>
      <span className="ar-readout__value readout ar-fluid-readout">
        {hasText(stat.prefix) ? <span className="ar-readout__affix">{stat.prefix}</span> : null}
        {stat.value}
        {hasText(stat.suffix) ? <span className="ar-readout__affix">{stat.suffix}</span> : null}
      </span>
      <span className="ar-readout__label">{stat.label}</span>
    </>
  );
  if (!href) return <div className="ar-readout">{body}</div>;
  return (
    <Link href={href} className="ar-readout">
      {body}
      {proofTitle ? <span className="ar-sr">{UI.home.readoutProof(proofTitle)}</span> : null}
      <span className="ar-readout__go" aria-hidden="true">
        <Icon icon={ArrowUpRight} size={18} />
      </span>
    </Link>
  );
}

/**
 * The stats row (bundle ReadoutRow): one glass panel, six readouts across from 1024 px, three on
 * tablets, two on phones, with rule hairlines between tiles. A stat without a value or a label
 * leaves no tile. Proofs go through the link resolver, so a proof to a hidden project is no link.
 */
export default function ReadoutRow({
  stats,
  resolveLink,
  projects,
}: {
  stats: Stat[];
  resolveLink: LinkResolver;
  /** The visible projects, to name each proof for screen readers. */
  projects: Pick<Project, 'slug' | 'title'>[];
}) {
  const shown = stats.filter((s) => hasText(s.value) && hasText(s.label));
  if (shown.length === 0) return null;
  const titles = new Map(projects.map((p) => [p.slug, p.title]));
  return (
    <ul className="ar-readouts">
      {shown.map((stat, i) => {
        const target = resolveLink(stat.proof);
        const href = target && !target.external ? target.href : undefined;
        const slug = href ? projectSlugOf(href) : null;
        return (
          <li key={`${stat.label}-${i}`}>
            <Readout stat={stat} href={href} proofTitle={slug ? titles.get(slug) : undefined} />
          </li>
        );
      })}
    </ul>
  );
}
