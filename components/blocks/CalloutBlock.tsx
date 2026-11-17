import Markdown from '@/components/ui/Markdown';
import { UI } from '@/lib/strings';
import type { BlockContext } from './context';

export default function CalloutBlock({ tone, md, ctx }: { tone: 'note' | 'status'; md: string; ctx: BlockContext }) {
  const label = tone === 'status' ? UI.callout.status : UI.callout.note;
  return (
    <aside aria-label={label} className="rounded-sm border border-line border-l-2 border-l-accent bg-surface p-4 md:p-5">
      <p className="mb-2 font-mono text-xs uppercase tracking-wider text-ink-mute">{label}</p>
      <Markdown md={md} resolveLink={ctx.resolveLink} />
    </aside>
  );
}
