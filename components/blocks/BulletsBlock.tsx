import Markdown from '@/components/ui/Markdown';
import { hasText } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Heading, type BlockContext, type HeadingLevel } from './context';

/** A list of at least this many items, none longer than SHORT_ITEM characters, sets in two columns from 768 px. */
const COLUMN_LIST = 4;
const SHORT_ITEM = 48;

/**
 * A bullets block (the canvas's pj-list): an optional heading (pj-h3) and the items, each after a
 * short line in the line color. A list of short items, such as the names of areas of work, sets
 * in two columns on rules from 768 px, as the canvas draws the six electrical areas.
 */
export default function BulletsBlock({
  heading,
  items,
  headingLevel,
  ctx,
}: {
  heading?: string;
  items: string[];
  headingLevel: HeadingLevel;
  ctx: BlockContext;
}) {
  const shown = items.filter(hasText);
  if (shown.length === 0 && !hasText(heading)) return null;
  const columns = shown.length >= COLUMN_LIST && shown.every((item) => item.trim().length <= SHORT_ITEM);
  return (
    <div>
      {hasText(heading) ? (
        <Heading level={headingLevel} className="pj-h3">
          {heading}
        </Heading>
      ) : null}
      {shown.length > 0 ? (
        <ul className={cn('pj-list', columns && 'pj-list--cols')}>
          {shown.map((item, i) => (
            <li key={i}>
              <Markdown md={item} resolveLink={ctx.resolveLink} inline />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
