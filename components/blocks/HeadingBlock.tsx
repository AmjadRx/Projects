import { Heading, type BlockContext } from './context';

export default function HeadingBlock({ text, id, ctx }: { text: string; id: string; ctx: BlockContext }) {
  return (
    <Heading level={ctx.level} id={`${ctx.idPrefix}${id}`} className="section-title mt-4">
      {text}
    </Heading>
  );
}
