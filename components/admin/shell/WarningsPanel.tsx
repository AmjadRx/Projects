'use client';

/**
 * The warning list (ARCHITECTURE.md 7.4; docs/ADMIN_GUIDE.md 5): the guard rails over the working
 * copy, computed in the browser (components/admin/state/warnings.ts) a moment after the owner
 * stops typing. Errors in the list are what the save's content check would refuse; warnings never
 * block a save. Each entry takes the owner to its field.
 *
 *   <WarningsPanel />                       every file, with a filter by file (the Settings tab)
 *   <WarningsPanel file={projectFile} />    one project's file (the project editor)
 */
import { useEffect, useId, useMemo, useState } from 'react';
import type { Finding } from '@/lib/admin/contract';
import { useAdmin } from '../state/hooks';
import { computeWarnings, countByFile } from '../state/warnings';
import { Section } from '../ui/bits';
import { FindingsList } from './FindingsList';
import { plural } from './format';

const NONE: Finding[] = [];

/** The warnings for the working copy, recomputed `delayMs` after the last edit. */
export function useWarnings(delayMs = 300): Finding[] {
  const doc = useAdmin((s) => s.doc);
  const [shown, setShown] = useState<Finding[]>(() => (doc ? computeWarnings(doc) : NONE));
  useEffect(() => {
    if (!doc) {
      setShown(NONE);
      return;
    }
    const timer = window.setTimeout(() => setShown(computeWarnings(doc)), delayMs);
    return () => window.clearTimeout(timer);
  }, [doc, delayMs]);
  return shown;
}

export interface WarningsPanelProps {
  /** Only this file's findings ("content/projects/raven.json"); without it, every file and a filter. */
  file?: string;
  title?: string;
  /** Heading level inside the page. */
  level?: 2 | 3;
}

export function WarningsPanel({ file, title = 'Warnings', level = 2 }: WarningsPanelProps) {
  const all = useWarnings();
  const filterId = useId();
  const [filter, setFilter] = useState<string>('all');
  const counts = useMemo(() => countByFile(all), [all]);
  const scope = file ?? (filter === 'all' ? null : filter);
  const shown = useMemo(() => (scope === null ? all : all.filter((f) => f.file === scope)), [all, scope]);
  const errors = shown.filter((f) => f.severity === 'error').length;
  const warnings = shown.length - errors;

  // A filter for a file that no longer has findings falls back to every file.
  useEffect(() => {
    if (filter !== 'all' && !counts.some((c) => c.file === filter)) setFilter('all');
  }, [counts, filter]);

  const summary =
    shown.length === 0
      ? 'No warnings.'
      : [errors > 0 ? `${plural(errors, 'error')} the save would refuse` : null, warnings > 0 ? plural(warnings, 'warning') : null]
          .filter(Boolean)
          .join(', ') + '.';

  return (
    <Section
      level={level}
      title={title}
      description="Warnings never block a save; errors here are what the save's content check would refuse. Select one to go to its field."
      actions={
        file === undefined && counts.length > 1 ? (
          <div className="adm-filter">
            <label htmlFor={filterId} className="adm-filter__label">
              Show
            </label>
            <select id={filterId} className="adm-input adm-select adm-select--compact" value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="all">All files ({all.length})</option>
              {counts.map((c) => (
                <option key={c.file} value={c.file}>
                  {c.file} ({c.errors + c.warnings})
                </option>
              ))}
            </select>
          </div>
        ) : null
      }
    >
      <p className="adm-muted" aria-live="polite">
        {summary}
      </p>
      <FindingsList findings={shown} showFile={scope === null} label={title} />
    </Section>
  );
}
