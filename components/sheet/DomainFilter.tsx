import { domainKey, projectDomains } from '@/lib/format';
import { UI } from '@/lib/strings';
import type { Project } from '@/lib/types';
import FilterBar, { type FilterOption } from './FilterBar';

/**
 * A domain's label in sentence case without changing its words: a spelling from the content that
 * already starts with a capital ("Embedded" over "embedded"); else the first spelling, with its
 * first letter raised only when it is all lowercase ("high voltage" to "High voltage"), so names
 * such as "eVTOL" and "IoT" keep their own spelling.
 */
function domainLabel(spellings: string[]): string {
  const capital = spellings.find((s) => /^\p{Lu}/u.test(s));
  if (capital) return capital;
  const first = spellings[0];
  return first === first.toLowerCase() ? first.charAt(0).toUpperCase() + first.slice(1) : first;
}

/**
 * The projects' domains as filter options (docs/V3_PLAN.md Q-11): the comma-separated `domain`
 * values, grouped without regard to case, the most used first, then by name, as the design shows.
 */
export function domainOptions(projects: Pick<Project, 'domain'>[]): Omit<FilterOption, 'result'>[] {
  const map = new Map<string, { key: string; spellings: string[]; count: number }>();
  for (const project of projects) {
    const seen = new Set<string>();
    for (const domain of projectDomains(project)) {
      const key = domainKey(domain);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const existing = map.get(key);
      if (existing) {
        existing.count += 1;
        existing.spellings.push(domain);
      } else map.set(key, { key, spellings: [domain], count: 1 });
    }
  }
  return [...map.values()]
    .map(({ key, spellings, count }) => ({ key, label: domainLabel(spellings), count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'en', { sensitivity: 'base' }));
}

/**
 * The domain filter for /projects (FilterBar with its words). The cards in `gridId` must carry
 * `data-card` and `data-domains` (ProjectCard does).
 */
export default function DomainFilter({ projects, gridId }: { projects: Pick<Project, 'domain'>[]; gridId: string }) {
  const total = projects.length;
  const options = domainOptions(projects).map((option) => ({ ...option, result: UI.projects.showing(option.count, total) }));
  return (
    <FilterBar
      gridId={gridId}
      label={UI.projects.filterLabel}
      all={{ label: UI.projects.filterAll, count: total, result: UI.projects.showing(total, total) }}
      options={options}
    />
  );
}
