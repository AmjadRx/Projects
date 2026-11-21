import Markdown from '@/components/ui/Markdown';
import type { BlockContext } from './context';

/** A text block: the content's Markdown at the reading measure, 17 px in ink (the canvas's pj-text). */
export default function TextBlock({ md, ctx }: { md: string; ctx: BlockContext }) {
  return <Markdown md={md} resolveLink={ctx.resolveLink} className="pj-text" />;
}
