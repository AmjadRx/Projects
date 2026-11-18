import { Heading, type BlockContext } from './context';

/** A heading block: a section heading in the body (the canvas's pj-h2), its id an anchor under the nav. */
export default function HeadingBlock({ text, id, ctx }: { text: string; id: string; ctx: BlockContext }) {
  return (
    <Heading level={ctx.level} id={`${ctx.idPrefix}${id}`} className="pj-h2">
      {text}
    </Heading>
  );
}
