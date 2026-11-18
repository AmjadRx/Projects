import { Fragment } from 'react';
import { hasText } from '@/lib/format';
import type { LinkResolver } from '@/lib/links';
import { UI } from '@/lib/strings';
import type { Project, Site } from '@/lib/types';
import { cn } from '@/lib/utils';
import TextLink from './TextLink';

const TIERS = ['deep', 'strong', 'familiar'] as const;

/** "01", "02": item numbers in the drawing's style. */
function itemNumber(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** True when at least one skill has words, so the table (and its section) has something to show. */
export function hasSkills(skills: Site['skills']): boolean {
  return skills.groups.some((group) => TIERS.includes(group.tier) && group.items.some((item) => hasText(item.label)));
}

/**
 * Skills as a drawing's bill of materials (bundle BomTable, bundle.css 15; DESIGN_DIRECTION.md 5.5),
 * never chips: ITEM, SKILL, PROOF, in three tiers by depth (Deep, Strong, Familiar), each with its
 * groups. Items are numbered through the whole table in B612 Mono. The proof links to the visible
 * project that uses the skill, through the link resolver; a proof that does not resolve, or none,
 * leaves the cell empty (screen readers hear "No project page"), never a dash. On phones the rows
 * stack, the proof under the skill. Put it on Glass over the sky.
 */
export default function BomTable({
  skills,
  projects,
  resolveLink,
  className,
}: {
  skills: Site['skills'];
  /** The visible projects, for the proof's words: a proof names one of these by its title. */
  projects: Pick<Project, 'slug' | 'title'>[];
  /** The link resolver: a proof to a page the site does not render prints no link. */
  resolveLink: LinkResolver;
  className?: string;
}) {
  const titles = new Map(projects.map((p) => [p.slug, p.title]));
  let item = 0;
  const tiers = TIERS.map((tier) => ({
    tier,
    groups: skills.groups
      .filter((group) => group.tier === tier)
      .map((group) => ({ title: group.title, items: group.items.filter((i) => hasText(i.label)) }))
      .filter((group) => group.items.length > 0),
  })).filter((t) => t.groups.length > 0);
  if (tiers.length === 0) return null;

  return (
    <table className={cn('ar-table ar-bom', className)}>
      <caption className="ar-sr">{UI.about.bomTable}</caption>
      <colgroup>
        <col className="ar-bom__item-col" />
        <col />
        <col className="ar-bom__proof-col" />
      </colgroup>
      <thead>
        <tr>
          <th scope="col" className="ar-th-caps">
            {UI.about.item}
          </th>
          <th scope="col" className="ar-th-caps">
            {UI.about.skill}
          </th>
          <th scope="col" className="ar-th-caps">
            {UI.about.proof}
          </th>
        </tr>
      </thead>
      {tiers.map(({ tier, groups }) => (
        <tbody key={tier}>
          <tr className="ar-bom__tier">
            <th colSpan={3} scope="rowgroup">
              {UI.about.tiers[tier]}
            </th>
          </tr>
          {groups.map((group, g) => (
            <Fragment key={`${group.title}-${g}`}>
              {hasText(group.title) ? (
                <tr className="ar-bom__group">
                  <th colSpan={3} scope="rowgroup">
                    {group.title}
                  </th>
                </tr>
              ) : null}
              {group.items.map((skill, i) => {
                item += 1;
                const slug = skill.proof?.trim() ?? '';
                const title = slug ? titles.get(slug) : undefined;
                const target = title ? resolveLink(`/projects/${slug}`) : null;
                return (
                  <tr className="ar-bom__row" key={`${skill.label}-${i}`}>
                    <td className="ar-bom__n">{itemNumber(item)}</td>
                    <td className="ar-bom__skill">{skill.label}</td>
                    <td className="ar-bom__proof">
                      {target && title ? (
                        <TextLink href={target.href} variant="standalone">
                          {title}
                        </TextLink>
                      ) : (
                        <span className="ar-sr">{UI.about.noProof}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </Fragment>
          ))}
        </tbody>
      ))}
    </table>
  );
}
