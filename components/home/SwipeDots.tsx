import { cn } from '@/lib/utils';

/**
 * The marks under the phone's strip of featured cards (the canvas's hm-swipe): one per card, the
 * card in view (`active`) drawn in the line color. Decorative, since the cards themselves are the
 * content, so they are hidden from assistive technology. FeaturedStrip says which card is in view:
 * the scrolling strip's, or the carousel's page once it takes over. Shown under 768 px only.
 */
export default function SwipeDots({ count, active }: { count: number; active: number }) {
  return (
    <span className="hm-swipe__dots" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className={cn('hm-swipe__dot', i === active && 'is-on')} />
      ))}
    </span>
  );
}
