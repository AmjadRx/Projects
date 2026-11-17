'use client';

import { useId, useState } from 'react';
import { UI } from '@/lib/strings';

export interface DomainOption {
  /** Lowercase key from domainKey(), safe in a CSS attribute selector. */
  key: string;
  label: string;
  count: number;
}

/**
 * Filters the project grid by domain (docs/V3_PLAN.md D-58). The cards are server HTML; this
 * control only writes one CSS rule that hides the cards outside the chosen domain, so the full
 * list stays in the page and works with no script. No layout animation in this phase.
 */
export default function DomainFilter({ gridId, options, total }: { gridId: string; options: DomainOption[]; total: number }) {
  const [selected, setSelected] = useState('');
  const selectId = useId();
  const chosen = options.find((option) => option.key === selected);
  const safeKey = chosen ? chosen.key.replace(/[^a-z0-9-]/g, '') : '';
  const safeGrid = gridId.replace(/[^a-zA-Z0-9_-]/g, '');

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <label htmlFor={selectId} className="text-sm text-ink-dim">
        {UI.projects.filterLabel}
      </label>
      <select
        id={selectId}
        value={selected}
        onChange={(event) => setSelected(event.target.value)}
        className="min-h-[44px] rounded-sm border border-line bg-surface px-3 text-sm text-ink"
      >
        <option value="">{UI.projects.filterAll}</option>
        {options.map((option) => (
          <option key={option.key} value={option.key}>
            {option.label} ({option.count})
          </option>
        ))}
      </select>
      <p className="data text-sm text-ink-mute" aria-live="polite">
        {UI.projects.showing(chosen ? chosen.count : total, total)}
      </p>
      {safeKey && (
        <style>{`#${safeGrid} [data-card]:not([data-domains~="${safeKey}"]){display:none}`}</style>
      )}
    </div>
  );
}
