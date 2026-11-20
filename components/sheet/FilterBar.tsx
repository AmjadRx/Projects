'use client';

export interface FilterOption {
  /** Lowercase key from domainKey(). */
  key: string;
  label: string;
  count: number;
  /** The result line while this option is chosen ("Showing 6 of 12 projects"), built on the server. */
  result: string;
}

/** The filter's words and options, built on the server (DomainFilter's domainFilter). */
export interface FilterWords {
  /** The group's accessible name ("Filter by domain"). */
  label: string;
  all: Omit<FilterOption, 'key'>;
  options: FilterOption[];
}

/**
 * The domain filter on /projects (bundle FilterBar, bundle.css 31; docs/V3_PLAN.md D-58): toggle
 * buttons with aria-pressed in a labelled group, "All" first, each with its count, never pills.
 * The result line is announced politely. The pressed state and the count change at once, and
 * focus stays on the pressed button while the cards reflow (motion sheet 7.4; ProjectExplorer owns
 * the choice and the cards). Phones get one row that scrolls sideways.
 *
 * Every word arrives in props (DomainFilter builds them from lib/strings.ts on the server).
 */
export default function FilterBar({
  label,
  all,
  options,
  selected,
  onSelect,
  controls,
}: FilterWords & {
  /** The chosen option's key; '' is All. */
  selected: string;
  onSelect: (key: string) => void;
  /** The id of the element that holds the cards. */
  controls?: string;
}) {
  const chosen = options.find((option) => option.key === selected);
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
            aria-controls={controls}
            onClick={() => onSelect(option.key)}
          >
            <span>{option.label}</span>
            <span className="ar-filter__n">{option.count}</span>
          </button>
        ))}
      </div>
      <p className="ar-filter__count" aria-live="polite">
        {chosen ? chosen.result : all.result}
      </p>
    </div>
  );
}
