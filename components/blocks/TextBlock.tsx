import Markdown from '@/components/ui/Markdown';
import type { BlockContext } from './context';

export default function TextBlock({ md, ctx }: { md: string; ctx: BlockContext }) {
  return <Markdown md={md} resolveLink={ctx.resolveLink} className="text-base md:text-lg" />;
}
