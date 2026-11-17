import Markdown from '@/components/ui/Markdown';
import { hasText } from '@/lib/format';
import { Heading, type BlockContext, type HeadingLevel } from './context';

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
  return (
    <div>
      {hasText(heading) && (
        <Heading level={headingLevel} className="mb-3 text-lg font-semibold md:text-xl">
          {heading}
        </Heading>
      )}
      {shown.length > 0 && (
        <ul className="prose-md list-disc space-y-2 pl-5 text-base md:text-lg">
          {shown.map((item, i) => (
            <li key={i}>
              <Markdown md={item} resolveLink={ctx.resolveLink} inline />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
