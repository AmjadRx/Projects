import { Fragment, type CSSProperties } from 'react';
import Image from 'next/image';
import { ArrowRight } from 'lucide-react';
import AvailabilityBadge from '@/components/sheet/AvailabilityBadge';
import Button from '@/components/sheet/Button';
import Placeholder from '@/components/sheet/Placeholder';
import Poster, { canOptimize } from '@/components/viewers/shared/Poster';
import Headline from './hero/Headline';
import HeroDrawing from './hero/HeroDrawing';
import HeroMediaFallback from './HeroMediaFallback';
import HeroVideo from './HeroVideo';
import HeroModel from './hero/HeroModel';
import { gpaText, hasText } from '@/lib/format';
import { introScript } from '@/lib/intro';
import { aspectOf, objectPosition, type ResolvedMedia } from '@/lib/media';
import { resolveMedia } from '@/lib/media-server';
import { load, toMs } from '@/lib/motion';
import { UI } from '@/lib/strings';
import type { Project, Site } from '@/lib/types';

/** The project the second hero button opens (docs/V3_PLAN.md Q-10): it hides if that project is hidden. */
const SECOND_BUTTON_SLUG = 'raven';

/** The hero column: 40vw (487 px at most) from 1024 px, 28rem from 768 px, else 90vw. */
const COLUMN_SIZES = '(min-width: 1024px) 40vw, (min-width: 768px) 28rem, 90vw';

/** The visual's frame when nothing is uploaded: the drawing's box (600 by 560), so the hero keeps its shape. */
const EMPTY_RATIO = 600 / 560;

/** The headline's give-up (sheet 2.4), which app/motion-drawing.css reads from the section. */
const HEADLINE_STYLE = { '--hm-headline-giveup': `${toMs(load.headline.giveUpAfter)}ms` } as CSSProperties;

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
 * The hero visual by `settings.heroMode` (ARCHITECTURE.md 6), the one place the mode is read:
 * `drawing` is Raven in plan view with the thermal lens; `media` the owner's photo or video, with
 * the lens off, and the drawing in its place, in the same box, if the photo or the video's poster
 * does not load (./HeroMediaFallback.tsx; the states boards, S.5). `model` shows the drawing
 * until the owner's model hero joins here (components/home/hero/HeroModel.tsx, as its own branch).
 */
function HeroArt({ settings }: { settings: Site['settings'] }) {
  switch (settings.heroMode) {
    case 'media':
      return (
        <HeroMediaFallback fallback={<HeroDrawing />}>
          <HeroVisual media={resolveMedia(settings.heroMedia)} />
        </HeroMediaFallback>
      );
    case 'model':
      // The owner's model, or the drawing until a model file is uploaded (ARCHITECTURE.md 6).
      return <HeroModel model={settings.heroModel} fallback={<HeroDrawing />} />;
    case 'drawing':
    default:
      return <HeroDrawing />;
  }
}

/**
 * The hero (ARCHITECTURE.md 5; the canvas's hm-hero): the headline, the sub-tagline, the degree
 * line with the labelled GPA, two buttons, the availability badge, and the hero visual. From
 * 1024 px the copy takes columns 1 to 7 and the visual columns 8 to 12; below that the headline
 * comes first, then the visual, then the rest. On Blueprint a scrim sits under the copy.
 * "See the work" is the page's one primary button.
 *
 * The load sequence (DESIGN_DIRECTION.md 6.2; lib/intro.ts): the section's first child is the
 * inline script that, once a visit, marks the section with data-intro before anything in it
 * paints. The headline (hero/Headline.tsx) keys off that mark: its start state, its line reveal on
 * Motion+ splitText, and its give-up after load.headline.giveUpAfter, which the section passes to
 * app/motion-drawing.css as --hm-headline-giveup (introAge counts from the mark). The drawing holds
 * its start state from the same mark and runs its steps from a second one, data-intro-go, set by
 * HeroDrawing's own inline script once the whole drawing is in the page (or, for the drawing that
 * takes a failed photo's slot, by its DrawingStage as it mounts). The scripts set
 * attributes in the browser, hence suppressHydrationWarning on the section.
 */
export default function Hero({ site, projects }: { site: Site; projects: Project[] }) {
  const { personal, settings } = site;
  const second = projects.find((p) => p.slug === SECOND_BUTTON_SLUG);
  const degreeParts = [
    { text: personal.degree, gpa: false },
    { text: personal.school, gpa: false },
    { text: gpaText(personal), gpa: true },
    { text: hasText(personal.graduation) ? `${UI.hero.graduation} ${personal.graduation}` : '', gpa: false },
  ].filter((part) => hasText(part.text));
  const showBadge = settings.showAvailabilityBadge && hasText(personal.availability);

  return (
    <section className="hm-hero hm-hero--scrim" aria-labelledby="hero-title" style={HEADLINE_STYLE} suppressHydrationWarning>
      <script dangerouslySetInnerHTML={{ __html: introScript() }} />
      <div className="hm-wrap">
        <div className="hm-hero__grid">
          <div className="hm-hero__copy">
            <Headline text={hasText(personal.tagline) ? personal.tagline : personal.name} />
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
          <HeroArt settings={settings} />
        </div>
      </div>
    </section>
  );
}
