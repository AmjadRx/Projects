'use client';

/**
 * A list of content-check findings: the errors of a refused save, the warnings a save returned,
 * or the guard rails of the WarningsPanel. Each one names its rule id, file, and field path, with
 * the rule's message; clicking it takes the owner to the field (`store.reveal`).
 */
import type { Finding } from '@/lib/admin/contract';
import { locate } from '@/lib/admin/locate';
import { useAdminStore } from '../state/hooks';
import { Badge } from '../ui/bits';
import { cx } from '../ui/cx';

export interface FindingsListProps {
  findings: readonly Finding[];
  /** Show each finding's file (off inside a panel that is already about one file). */
  showFile?: boolean;
  className?: string;
  /** The list's accessible name. */
  label?: string;
}

export function FindingsList({ findings, showFile = true, className, label }: FindingsListProps) {
  const store = useAdminStore();
  if (findings.length === 0) return null;
  return (
    <ul className={cx('adm-findings', className)} aria-label={label}>
      {findings.map((finding, i) => {
        const where = locate(finding.file, finding.path);
        const canGo = where !== null && where.ids.length > 0;
        const body = (
          <>
            <span className="adm-finding__top">
              <Badge tone={finding.severity === 'error' ? 'error' : 'warning'}>{finding.severity === 'error' ? 'Error' : 'Warning'}</Badge>
              <span className="adm-finding__rule">{finding.rule}</span>
              <span className="adm-finding__where">
                {showFile ? <span className="adm-finding__file">{finding.file}</span> : null}
                <span className="adm-finding__path">{finding.path}</span>
              </span>
            </span>
            <span className="adm-finding__msg">{finding.message}</span>
          </>
        );
        return (
          <li key={`${finding.file}|${finding.path}|${finding.rule}|${i}`}>
            {canGo ? (
              <button type="button" className="adm-finding" onClick={() => store.reveal(finding.file, finding.path)}>
                {body}
                <span className="adm-sr"> Go to this field.</span>
              </button>
            ) : (
              <div className="adm-finding adm-finding--static">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
