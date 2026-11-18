import { Fragment, type CSSProperties } from 'react';
import Image from 'next/image';
import { ArrowRight } from 'lucide-react';
import AvailabilityBadge from '@/components/sheet/AvailabilityBadge';
import Button from '@/components/sheet/Button';
import Placeholder from '@/components/sheet/Placeholder';
import Poster, { canOptimize } from '@/components/viewers/shared/Poster';
import HeroVideo from './HeroVideo';
import { gpaText, hasText } from '@/lib/format';
import { aspectOf, objectPosition, type ResolvedMedia } from '@/lib/media';
import { resolveMedia } from '@/lib/media-server';
import { UI } from '@/lib/strings';
import type { Project, Site } from '@/lib/types';

/** The project the second hero button opens (docs/V3_PLAN.md Q-10): it hides if that project is hidden. */
const SECOND_BUTTON_SLUG = 'raven';

/** The hero column: 40vw (487 px at most) from 1024 px, 28rem from 768 px, else 90vw. */
const COLUMN_SIZES = '(min-width: 1024px) 40vw, (min-width: 768px) 28rem, 90vw';

/** The visual's frame when nothing is uploaded: the drawing's box (600 by 560), so the hero keeps its shape. */
const EMPTY_RATIO = 600 / 560;

/**
 * `sizes` for the hero visual. The well is capped at 78vh, so a tall picture is drawn
 * 78vh x (width / height) wide, narrower than its column. That width and the column width are
 * both upper bounds of the drawn width, so either is safe; the one that is smaller on common
 * screens is used (a 487 px column on a 900 px tall desktop, about 400 px on a 750 px tall phone).
 */
function heroSizes(ratio: number | undefined): string {
  if (!ratio || !Number.isFinite(ratio)) return COLUMN_SIZES;
  const capped = `${(78 * ratio).toFixed(1)}vh`;
  if (ratio < 0.68) return capped;
  return `(min-width: 1024px) ${ratio < 0.73 ? capped : '40vw'}, (min-width: 768px) 28rem, 90vw`;
}

/** A well at the media's own ratio and at most 78vh tall: its width follows the cap, so nothing is cropped or letterboxed. */
function wellStyle(ratio: number): CSSProperties {
  return { aspectRatio: String(ratio), width: `min(100%, calc(78vh * ${ratio.toFixed(4)}))` };
}

/**
 * The visual in `media` mode (ARCHITECTURE.md 6: "an image or a muted looping video with a
 * poster"): a photo at its own ratio, a video behind its poster with Play and Pause, another kind's
 * poster still, or the placeholder when there is nothing to show. The first paint is the poster.
 */
function HeroVisual({ media }: { media: ResolvedMedia | null }) {
  const ratio = media?.width && media.height ? media.width / media.height : undefined;

  if (media?.kind === 'video') {
    return (
      <HeroVideo
        src={media.file.src}
        label={media.alt}
        aspect={aspectOf(media, 16 / 9)}
        labels={{ play: UI.hero.playVideo, pause: UI.hero.pauseVideo }}
      >
        <Poster media={media} priority sizes={heroSizes(ratio ?? 16 / 9)} />
      </HeroVideo>
    );
  }

  if (media && media.kind !== 'image' && media.poster) {
    const shown = aspectOf(media, 16 / 9);
    return (
      <div className="ar-well hm-hero__media" style={wellStyle(shown)}>
        <Poster media={media} priority sizes={heroSizes(ratio ?? 16 / 9)} />
      </div>
    );
  }

  if (media?.kind === 'image') {
    // An image of unknown size keeps the 3:4 box and shows whole; a known one fills a box of its own ratio.
    const shown = ratio ?? 3 / 4;
    return (
      <div className="ar-well hm-hero__media" style={wellStyle(shown)}>
        <Image
          src={media.file.src}
          alt={media.alt}
          fill
          priority
          sizes={heroSizes(ratio)}
          unoptimized={!canOptimize(media.file.src)}
          style={{ objectFit: ratio ? 'cover' : 'contain', objectPosition: objectPosition(media.focal) }}
        />
      </div>
    );
  }

  return (
    <div className="ar-well hm-hero__media" style={wellStyle(EMPTY_RATIO)}>
      <Placeholder text={UI.placeholder.photoToCome} />
    </div>
  );
}

/**
 * The hero (ARCHITECTURE.md 5; the canvas's hm-hero): the headline, the sub-tagline, the degree
 * line with the labelled GPA, two buttons, the availability badge, and the hero visual. From
 * 1024 px the copy takes columns 1 to 7 and the visual columns 8 to 12; below that the headline
 * comes first, then the visual, then the rest. On Blueprint a scrim sits under the copy.
 *
 * Phase 3 and 4 show the visual in `media` mode whatever `settings.heroMode` says; the drawing
 * and the model arrive in Phase 5. "See the work" is the page's one primary button.
 */
export default function Hero({ site, projects }: { site: Site; projects: Project[] }) {
  const { personal, settings } = site;
  const media = resolveMedia(settings.heroMedia);
  const second = projects.find((p) => p.slug === SECOND_BUTTON_SLUG);
  const degreeParts = [
    { text: personal.degree, gpa: false },
    { text: personal.school, gpa: false },
    { text: gpaText(personal), gpa: true },
    { text: hasText(personal.graduation) ? `${UI.hero.graduation} ${personal.graduation}` : '', gpa: false },
  ].filter((part) => hasText(part.text));
  const showBadge = settings.showAvailabilityBadge && hasText(personal.availability);

  return (
    <section className="hm-hero hm-hero--scrim" aria-labelledby="hero-title">
      <div className="hm-wrap">
        <div className="hm-hero__grid">
          <div className="hm-hero__copy">
            <h1 className="hm-hero__title" id="hero-title">
              {hasText(personal.tagline) ? personal.tagline : personal.name}
            </h1>
            <div className="hm-hero__rest">
              {hasText(personal.subTagline) ? <p className="hm-hero__sub">{personal.subTagline}</p> : null}
              {degreeParts.length > 0 ? (
                <p className="hm-hero__degree">
                  {degreeParts.map((part, i) => (
                    <Fragment key={i}>
                      {i > 0 ? (
                        <>
                          {' '}
                          <span className="hm-hero__dot" aria-hidden="true">
                            ·
                          </span>{' '}
                        </>
                      ) : null}
                      {part.gpa ? <span className="hm-hero__gpa">{part.text}</span> : part.text}
                    </Fragment>
                  ))}
                </p>
              ) : null}
              <div className="hm-hero__actions">
                <Button variant="primary" href="/projects" icon={ArrowRight}>
                  {UI.hero.seeTheWork}
                </Button>
                {second ? (
                  <Button variant="secondary" href={`/projects/${second.slug}`}>
                    {UI.hero.openProject(second.title)}
                  </Button>
                ) : null}
              </div>
              {showBadge ? (
                <div className="hm-hero__avail">
                  <AvailabilityBadge text={personal.availability} />
                </div>
              ) : null}
            </div>
          </div>
          <div className="hm-hero__art">
            <HeroVisual media={media} />
          </div>
        </div>
      </div>
    </section>
  );
}
