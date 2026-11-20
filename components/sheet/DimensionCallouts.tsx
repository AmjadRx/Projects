import type { ResolvedMedia } from '@/lib/media';
import { UI } from '@/lib/strings';
import type { Callout } from '@/lib/types';
import { cn } from '@/lib/utils';
import { CalloutRow, shownCallouts } from './callouts';
import DimensionFigure from './DimensionFigure';
import Placeholder from './Placeholder';

/** The still that stands for a cover: the photo, or the poster of a video or model. */
function coverStill(media: ResolvedMedia | null): { src: string; alt: string } | null {
  if (!media) return null;
  if (media.kind === 'image') return { src: media.file.src, alt: media.alt };
  return media.poster ? { src: media.poster.src, alt: media.alt } : null;
}

/**
 * The cover in a 16:10 night well with up to three documented numbers drawn over it as dimension
 * lines (bundle DimensionCallouts, bundle.css 11).
 *
 * - layout `auto` (project pages): drawn over the cover from 768 px, a row of readouts on glass
 *   under it on phones. `over` (cards): drawn over the cover from 768 px, a plain row of readouts
 *   under it on phones (DESIGN_DIRECTION.md 5.2 and 7; app/motion-cards.css), never both. `row`:
 *   always the row.
 * - `drawn` (the project page): the lines draw once, when the photo has loaded and the cover has
 *   landed. Without it they draw while a mouse or pen is over the card and undraw on leave (motion
 *   sheet 5.3; DimensionFigure), and show and go at once under reduced motion.
 * - No photo (an empty cover): the "Photo to come" placeholder, nothing drawn on it, and the
 *   callouts as the row at every width; a card (`over`) shows no callouts. A photo that fails to
 *   load does the same in the browser, with Try again when `retry` is on (never on a card).
 * - `zoom`: the well is a button that opens the cover in the lightbox (the project page).
 *
 * `callouts` are the project's own; empty ones are dropped and at most three are drawn. A video or
 * model cover shows its poster here; on the project page the viewer takes the well instead, with
 * CalloutRow (./callouts) under it.
 */
export default function DimensionCallouts({
  media,
  callouts,
  layout = 'auto',
  drawn = false,
  zoom = false,
  retry = true,
  sizes,
  priority = false,
  className,
}: {
  media: ResolvedMedia | null;
  callouts?: Callout[];
  layout?: 'auto' | 'over' | 'row';
  drawn?: boolean;
  zoom?: boolean;
  retry?: boolean;
  /** next/image `sizes` for the well's width at each breakpoint. */
  sizes: string;
  priority?: boolean;
  className?: string;
}) {
  const list = shownCallouts(callouts);
  const still = coverStill(media);

  if (!media || !still) {
    return (
      <figure className={cn('ar-dim', `ar-dim--${layout}`, 'ar-dim--nophoto', className)}>
        <div className="ar-well">
          <Placeholder text={UI.placeholder.photoToCome} />
        </div>
        {layout !== 'over' ? <CalloutRow callouts={list} label={UI.projects.callouts} /> : null}
      </figure>
    );
  }

  return (
    <DimensionFigure
      media={media}
      src={still.src}
      alt={still.alt}
      focal={media.focal}
      callouts={list}
      layout={layout}
      drawn={drawn}
      zoom={zoom}
      retry={retry && layout !== 'over'}
      sizes={sizes}
      priority={priority}
      labels={{
        didNotLoad: UI.placeholder.didNotLoad,
        tryAgain: UI.placeholder.tryAgain,
        keyFigures: UI.projects.callouts,
        openImage: UI.viewers.image.open,
      }}
      className={className}
    />
  );
}
