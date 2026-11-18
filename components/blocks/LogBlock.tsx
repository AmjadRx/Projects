import Glass from '@/components/sheet/Glass';
import RevisionTable, { type RevisionRow } from '@/components/sheet/RevisionTable';
import { resolveMedia } from '@/lib/media-server';
import { UI } from '@/lib/strings';
import type { MediaRef } from '@/lib/types';
import { Heading, type BlockContext } from './context';

type Entry = { date: string; title: string; md: string; media?: MediaRef[] };

/**
 * The build log as a drawing revision table, newest first (DESIGN_DIRECTION.md 5.6; the canvas's
 * pj-log): a drafting label over the table on glass.
 */
export default function LogBlock({ id, entries, ctx }: { id: string; entries: Entry[]; ctx: BlockContext }) {
  const rows: RevisionRow[] = entries.map((entry, i) => ({
    key: `${id}-${i}`,
    date: entry.date,
    title: entry.title,
    md: entry.md,
    media: (entry.media ?? []).map(resolveMedia).filter((m) => m !== null),
  }));
  return (
    <>
      <Heading level={ctx.level} className="hm-label">
        {UI.projects.buildLog}
      </Heading>
      <Glass>
        <RevisionTable rows={rows} resolveLink={ctx.resolveLink} anchorPrefix={`${ctx.idPrefix}${id}-rev-`} />
      </Glass>
    </>
  );
}
