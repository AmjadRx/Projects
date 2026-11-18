import { hasText } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Label and value rows from a specTable block (bundle SpecTable, bundle.css 15): the label in
 * Archivo, the value in B612 Mono, exactly as stored, hedges and units included. Rules above and
 * below, hairlines between rows, no header row; `caption` names the table for screen readers (the
 * content's heading block names it on the page). Labels take a third of the width; on phones the
 * label sits above its value. Put it on Glass over the sky. A row with neither label nor value is
 * left out, and with no rows there is no table.
 */
export default function SpecTable({
  rows,
  caption,
  className,
}: {
  rows: { label: string; value: string }[];
  caption?: string;
  className?: string;
}) {
  const shown = rows.filter((row) => hasText(row.label) || hasText(row.value));
  if (shown.length === 0) return null;
  return (
    <table className={cn('ar-table ar-spec', className)}>
      {hasText(caption) ? <caption className="ar-sr">{caption}</caption> : null}
      <tbody>
        {shown.map((row, i) => (
          <tr key={`${row.label}-${i}`}>
            <th scope="row">{row.label}</th>
            <td>{row.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
