import Image from 'next/image';
import Link from 'next/link';
import Poster, { canOptimize } from '@/components/viewers/shared/Poster';
import { PhotoPlaceholder } from '@/components/ui/MediaImage';
import HeroVideo from './HeroVideo';
import { gpaText, hasText } from '@/lib/format';
import { aspectOf, objectPosition } from '@/lib/media';
import { resolveMedia } from '@/lib/media-server';
import { UI } from '@/lib/strings';
import type { Project, Site } from '@/lib/types';

/** The project the second hero button opens (docs/V3_PLAN.md Q-10): it hides if that project is hidden. */
const SECOND_BUTTON_SLUG = 'raven';

/** The hero column: 40vw (487 px at most) from 1024 px, 28rem from 768 px, else 90vw. */
const COLUMN_SIZES = '(min-width: 1024px) 40vw, (min-width: 768px) 28rem, 90vw';

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

/**
 * The hero (ARCHITECTURE.md 5): the headline, the sub-tagline, the degree line with the labelled
 * GPA, two buttons, the availability badge, and the hero visual. Phase 3 shows the visual in
 * `media` mode whatever `settings.heroMode` says; the drawing and the model arrive in Phase 5.
 * Media mode is "an image or a muted looping video with a poster" (ARCHITECTURE.md 6); another
 * kind shows its poster still, or the placeholder when it has none.
 */
export default function Hero({ site, projects }: { site: Site; projects: Project[] }) {
  const { personal, settings } = site;
  const media = resolveMedia(settings.heroMedia);
  const ratio = media?.width && media.height ? media.width / media.height : undefined;
  const second = projects.find((p) => p.slug === SECOND_BUTTON_SLUG);
  const degreeLine = [
    personal.degree,
    personal.school,
    gpaText(personal),
    hasText(personal.graduation) ? `${UI.hero.graduation} ${personal.graduation}` : '',
  ].filter(hasText);

  return (
    <section className="wrap grid gap-10 py-12 md:py-20 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:items-center">
      <div>
        <h1 className="display-1 max-w-[16ch]">{personal.tagline}</h1>
        {hasText(personal.subTagline) && <p className="body-lg mt-6 max-w-[62ch]">{personal.subTagline}</p>}
        {degreeLine.length > 0 && (
          <p className="data mt-6 max-w-[70ch] text-sm leading-relaxed text-ink-dim">
            {degreeLine.map((part, i) => (
              <span key={i}>
                {i > 0 && <span aria-hidden> · </span>}
                {part}
              </span>
            ))}
          </p>
        )}
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/projects" className="btn-primary">
            {UI.hero.seeTheWork}
          </Link>
          {second && (
            <Link href={`/projects/${second.slug}`} className="btn-ghost">
              {UI.hero.openProject(second.title)}
            </Link>
          )}
        </div>
        {settings.showAvailabilityBadge && hasText(personal.availability) && (
          <p className="mt-6">
            <span className="badge">{personal.availability}</span>
          </p>
        )}
      </div>

      <div className="relative mx-auto w-full max-w-md lg:max-w-none">
        {media?.kind === 'video' ? (
          <HeroVideo
            src={media.file.src}
            label={media.alt}
            aspect={aspectOf(media, 16 / 9)}
            labels={{ play: UI.hero.playVideo, pause: UI.hero.pauseVideo }}
          >
            <Poster media={media} priority sizes={heroSizes(ratio ?? 16 / 9)} />
          </HeroVideo>
        ) : media && media.kind !== 'image' && media.poster ? (
          <div className="viewer-frame">
            <div className="viewer-well" style={{ aspectRatio: String(aspectOf(media, 16 / 9)), maxHeight: '78vh' }}>
              <Poster media={media} priority sizes={heroSizes(ratio ?? 16 / 9)} />
            </div>
          </div>
        ) : media?.kind === 'image' ? (
          <div
            className="relative w-full overflow-hidden rounded-sm bg-well"
            style={{ aspectRatio: media.width && media.height ? `${media.width} / ${media.height}` : '3 / 4', maxHeight: '78vh' }}
          >
            <Image
              src={media.file.src}
              alt={media.alt}
              fill
              priority
              sizes={heroSizes(ratio)}
              unoptimized={!canOptimize(media.file.src)}
              className="object-contain"
              style={{ objectPosition: objectPosition(media.focal) }}
            />
          </div>
        ) : (
          <div className="relative w-full overflow-hidden rounded-sm" style={{ aspectRatio: '4 / 5' }}>
            <PhotoPlaceholder />
          </div>
        )}
      </div>
    </section>
  );
}
