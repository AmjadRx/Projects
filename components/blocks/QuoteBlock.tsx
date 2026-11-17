import { hasText } from '@/lib/format';

export default function QuoteBlock({ text, attribution }: { text: string; attribution?: string }) {
  return (
    <figure className="border-l-2 border-accent pl-5">
      <blockquote className="text-lg text-ink md:text-xl">
        <p>{text}</p>
      </blockquote>
      {hasText(attribution) && <figcaption className="mt-2 text-sm text-ink-mute">{attribution}</figcaption>}
    </figure>
  );
}
