import Glass from '@/components/sheet/Glass';
import { hasText } from '@/lib/format';

/**
 * A quote block: the content's sentence on glass (the canvas draws no quote; it takes the
 * callout's panel and the pitch's voice), with the attribution under it when there is one.
 */
export default function QuoteBlock({ text, attribution }: { text: string; attribution?: string }) {
  return (
    <Glass as="figure" className="pj-quote">
      <blockquote>
        <p>{text}</p>
      </blockquote>
      {hasText(attribution) ? <figcaption>{attribution}</figcaption> : null}
    </Glass>
  );
}
