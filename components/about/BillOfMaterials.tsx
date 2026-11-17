import Link from 'next/link';
import { hasText } from '@/lib/format';
import { UI } from '@/lib/strings';
import type { Project, Site } from '@/lib/types';

const TIERS = ['deep', 'strong', 'familiar'] as const;

/**
 * Skills as a bill of materials (DESIGN_DIRECTION.md 5.5): item number, skill, and proof (a link
 * to the project page where the skill is used), grouped by depth. A proof to a project that is
 * not visible prints nothing. Item numbers run through the whole bill. On phones rows stack.
 */
export default function BillOfMaterials({
  skills,
  projects,
}: {
  skills: Site['skills'];
  projects: Project[];
}) {
  const titles = new Map(projects.map((p) => [p.slug, p.title]));
  let item = 0;
  const tiers = TIERS.map((tier) => ({
    tier,
    groups: skills.groups
      .filter((group) => group.tier === tier)
      .map((group) => ({ group, items: group.items.filter((i) => hasText(i.label)) }))
      .filter(({ items }) => items.length > 0),
  })).filter(({ groups }) => groups.length > 0);

  return (
    <div className="flex flex-col gap-12">
      {tiers.map(({ tier, groups }) => (
        <section key={tier} aria-labelledby={`tier-${tier}`}>
          <h3 id={`tier-${tier}`} className="text-xl font-semibold">
            {UI.about.tiers[tier]}
          </h3>
          <div className="mt-4 flex flex-col gap-8">
            {groups.map(({ group, items }, g) => (
              <table key={`${group.title}-${g}`} className="table-plain max-md:block">
                <caption className="!pb-3 text-left font-medium !text-ink">{group.title}</caption>
                <thead className="max-md:sr-only">
                  <tr>
                    <th scope="col" className="w-16">
                      {UI.about.item}
                    </th>
                    <th scope="col">{UI.about.skill}</th>
                    <th scope="col" className="w-[40%]">
                      {UI.about.proof}
                    </th>
                  </tr>
                </thead>
                <tbody className="max-md:block">
                  {items.map((skill, i) => {
                    item += 1;
                    const proofTitle = skill.proof ? titles.get(skill.proof) : undefined;
                    return (
                      <tr key={`${skill.label}-${i}`} className="max-md:flex max-md:flex-wrap max-md:items-baseline max-md:gap-x-3 max-md:border-b max-md:border-line max-md:py-2">
                        <td className="data text-ink-mute max-md:border-0 max-md:p-0">
                          <span className="md:sr-only">{UI.about.item} </span>
                          {String(item).padStart(2, '0')}
                        </td>
                        <th scope="row" className="font-normal text-ink max-md:border-0 max-md:p-0">
                          {skill.label}
                        </th>
                        <td className="max-md:w-full max-md:border-0 max-md:p-0">
                          {proofTitle && (
                            <Link href={`/projects/${skill.proof}`} className="text-link inline-flex min-h-[44px] items-center">
                              <span className="md:sr-only">{UI.about.proof}: </span>
                              {proofTitle}
                            </Link>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
