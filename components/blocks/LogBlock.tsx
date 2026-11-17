import RevisionTable, { type RevisionRow } from '@/components/log/RevisionTable';
import { resolveMedia } from '@/lib/media-server';
import type { MediaRef } from '@/lib/types';
import type { BlockContext } from './context';

type Entry = { date: string; title: string; md: string; media?: MediaRef[] };

/** The build log as a drawing revision table, newest first (DESIGN_DIRECTION.md 5.6). */
export default function LogBlock({ id, entries, ctx }: { id: string; entries: Entry[]; ctx: BlockContext }) {
  const rows: RevisionRow[] = entries.map((entry, i) => ({
    key: `${id}-${i}`,
    date: entry.date,
    title: entry.title,
    md: entry.md,
    media: (entry.media ?? []).map(resolveMedia).filter((m) => m !== null),
  }));
  return <RevisionTable rows={rows} resolveLink={ctx.resolveLink} anchorPrefix={`${ctx.idPrefix}${id}-rev-`} />;
}
