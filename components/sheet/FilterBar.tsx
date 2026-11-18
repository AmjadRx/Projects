'use client';

import { useState } from 'react';

export interface FilterOption {
  /** Lowercase key from domainKey(), safe in a CSS attribute selector. */
  key: string;
  label: string;
  count: number;
  /** The result line while this option is chosen ("Showing 6 of 12 projects"), built on the server. */
  result: string;
}

/**
 * The domain filter on /projects (bundle FilterBar, bundle.css 31; docs/V3_PLAN.md D-58): toggle
 * buttons with aria-pressed in a labelled group, "All" first, each with its count, never pills.
 * The result line is announced politely. The cards stay server HTML: choosing a domain writes one
 * CSS rule that hides the cards outside it, so the whole list works with no script. Phones get one
 * row that scrolls sideways. No reflow animation until Phase 5.
 *
 * Every word arrives in props (DomainFilter builds them from lib/strings.ts on the server).
 */
export default function FilterBar({
  gridId,
  label,
  all,
  options,
}: {
  /** The id of the element that holds the cards (each card carries data-card and data-domains). */
  gridId: string;
  /** The group's accessible name ("Filter by domain"). */
  label: string;
  all: Omit<FilterOption, 'key'>;
  options: FilterOption[];
}) {
  const [selected, setSelected] = useState('');
  const chosen = options.find((option) => option.key === selected);
  const safeKey = chosen ? chosen.key.replace(/[^a-z0-9-]/g, '') : '';
  const safeGrid = gridId.replace(/[^a-zA-Z0-9_-]/g, '');
  const buttons = [{ key: '', label: all.label, count: all.count }, ...options];

  return (
    <div className="ar-filter">
      <div className="ar-filter__row" role="group" aria-label={label}>
        {buttons.map((option) => (
          <button
            key={option.key || 'all'}
            type="button"
            className="ar-filter__btn"
            aria-pressed={selected === option.key}
            onClick={() => setSelected(option.key)}
          >
            <span>{option.label}</span>
            <span className="ar-filter__n">{option.count}</span>
          </button>
        ))}
      </div>
      <p className="ar-filter__count" aria-live="polite">
        {chosen ? chosen.result : all.result}
      </p>
      {safeKey ? <style>{`#${safeGrid} [data-card]:not([data-domains~="${safeKey}"]){display:none}`}</style> : null}
    </div>
  );
}
