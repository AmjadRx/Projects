import Callout from '@/components/sheet/Callout';
import Markdown from '@/components/ui/Markdown';
import { UI } from '@/lib/strings';
import type { BlockContext } from './context';

/**
 * A callout block (bundle Callout): the content's sentence on glass, `status` drawn in phantom
 * line. The tone word ("Status", "Note") is read first by screen readers and is not drawn.
 */
export default function CalloutBlock({ tone, md, ctx }: { tone: 'note' | 'status'; md: string; ctx: BlockContext }) {
  return (
    <Callout tone={tone} label={tone === 'status' ? UI.callout.status : UI.callout.note}>
      <Markdown md={md} resolveLink={ctx.resolveLink} />
    </Callout>
  );
}
