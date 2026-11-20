import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { hasText, statusText } from '@/lib/format';
import type { ResolvedMedia } from '@/lib/media';
import { resolveMedia } from '@/lib/media-server';
import { UI } from '@/lib/strings';
import type { Callout, Project } from '@/lib/types';
import CardCover from './CardCover';
import CardShell from './CardShell';
import CoverImage from './CoverImage';
import DimensionCallouts from './DimensionCallouts';
import { domainKeys } from './DomainFilter';
import Icon from './Icon';
import MaturityScale from './MaturityScale';
import OpenCue from './OpenCue';

/**
 * next/image `sizes` for card covers in the layouts of the canvas: `featured` (full width, the
 * cover on 7 of 12 columns from 1024 px), `regular` (at most two columns), and `third` (three
 * columns from 1024 px, as on /projects).
 */
export const CARD_SIZES = {
  featured: '(min-width: 1280px) 720px, (min-width: 1024px) 58vw, (min-width: 768px) 50vw, 100vw',
  regular: '(min-width: 1280px) 600px, (min-width: 768px) 50vw, 100vw',
  third: '(min-width: 1280px) 400px, (min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw',
} as const;

const PLACEHOLDER_LABELS = { didNotLoad: UI.placeholder.didNotLoad, tryAgain: UI.placeholder.tryAgain };

/**
 * A cover that is a YouTube or Vimeo video (bundle cards.jsx, bundle.css 28): its poster, or the
 * bare night well when it has none, with its kind on a tag. A card never plays a third party's
 * player, never offers sound, and never orbits a model.
 */
function StillCover({ cover, sizes, priority }: { cover: ResolvedMedia; sizes: string; priority: boolean }) {
  const kind = cover.kind === 'model' ? UI.card.model : cover.kind === 'video' || cover.kind === 'embed' ? UI.card.video : '';
  return (
    <div className="ar-well ar-card__motion">
      {cover.poster ? (
        <CoverImage src={cover.poster.src} alt={cover.alt} focal={cover.focal} sizes={sizes} priority={priority} labels={PLACEHOLDER_LABELS} />
      ) : null}
      {kind ? <span className="ar-card__kind">{kind}</span> : null}
    </div>
  );
}

/** The cover in its well: a photo with its callouts, a video or a model that moves, or a still. */
function Cover({ cover, callouts, sizes, priority }: { cover: ResolvedMedia | null; callouts: Callout[] | undefined; sizes: string; priority: boolean }) {
  if (cover && (cover.kind === 'video' || cover.kind === 'model')) {
    const video = cover.kind === 'video';
    return (
      <CardCover
        kind={cover.kind}
        poster={cover.poster ? { src: cover.poster.src, alt: cover.alt, ...(cover.focal ? { focal: cover.focal } : {}) } : null}
        video={video ? cover.file.src : undefined}
        sizes={sizes}
        priority={priority}
        labels={{
          kind: video ? UI.card.video : UI.card.model,
          live: video ? UI.card.playing : UI.card.turning,
          ...PLACEHOLDER_LABELS,
        }}
      />
    );
  }
  if (cover && cover.kind !== 'image') return <StillCover cover={cover} sizes={sizes} priority={priority} />;
  return <DimensionCallouts media={cover} callouts={callouts} layout="over" retry={false} sizes={sizes} priority={priority} />;
}

/**
 * A project card (bundle ProjectCard, bundle.css 17; DESIGN_DIRECTION.md 5.8): the cover in a 16:10
 * well, the title, the one-line pitch, the maturity scale, and the status. No tags. The title's
 * link is stretched over the whole card, so the card is one link with the focus ring around it.
 *
 * - regular: glass with a rule border (a soft shadow in Whiteprint), the compact maturity scale.
 * - featured: from 1024 px full width with the cover on 7 columns and the text on 5, a 28 px title,
 *   the full scale, and an "Open project" cue whose arrow nudges on hover.
 * - Motion (sheet 5, in CardShell): a mouse or pen tilts the card toward it with a light along the
 *   rim, the callouts draw over a photo cover, a video cover plays and a model cover turns; phones
 *   get no tilt and nothing drawn (nothing depends on hover), and their moving covers run in view.
 *   Opening the card carries its cover into the project page (lib/cardTransition.ts).
 * - Phones (under 768 px): a photo cover's callouts are a plain row of readouts under it
 *   (DESIGN_DIRECTION.md 5.2 and 7), never drawn. A card with no photo has no callouts.
 * - No photo: "Photo to come"; a photo that fails: "Photo did not load", with no Try again.
 * - The status prints unless it repeats the maturity label; with no `statusLabel` it is the
 *   `status` value in sentence case (docs/V3_PLAN.md Q-12).
 *
 * `data-cover-card` names the cover that travels to the project page; `data-card` and
 * `data-domains` mark the card and its domain keys.
 */
export default function ProjectCard({
  project,
  variant = 'regular',
  headingLevel = 3,
  priority = false,
  sizes,
  className,
}: {
  project: Project;
  variant?: 'regular' | 'featured';
  /** 2 where the cards sit under the page's h1 (/projects), 3 under a section heading (home). */
  headingLevel?: 2 | 3;
  /** For the first cards in view: the cover loads first. */
  priority?: boolean;
  /** next/image `sizes` for the cover; defaults to CARD_SIZES for the variant. */
  sizes?: string;
  className?: string;
}) {
  const Heading = `h${headingLevel}` as 'h2' | 'h3';
  const cover = resolveMedia(project.cover);
  const coverSizes = sizes ?? (variant === 'featured' ? CARD_SIZES.featured : CARD_SIZES.regular);
  const domains = domainKeys(project);
  const maturity = project.maturity && hasText(project.maturity.label) ? project.maturity : null;
  const status = statusText(project);
  const showStatus = hasText(status) && (!maturity || status.trim() !== maturity.label.trim());

  return (
    <CardShell variant={variant} slug={project.slug} domains={domains.join(' ')} className={className}>
      <div className="ar-card__cover" data-cover-card={project.slug}>
        <Cover cover={cover} callouts={project.callouts} sizes={coverSizes} priority={priority} />
      </div>
      <div className="ar-card__body">
        <Heading className="ar-card__title">
          <Link href={`/projects/${project.slug}`} className="ar-card__link">
            {project.title}
          </Link>
        </Heading>
        {hasText(project.pitch) ? <p className="ar-card__pitch">{project.pitch}</p> : null}
        <MaturityScale maturity={maturity} variant={variant === 'featured' ? 'full' : 'compact'} />
        {showStatus ? <p className="ar-card__status">{status}</p> : null}
        {variant === 'featured' ? (
          <span className="ar-card__open" aria-hidden="true">
            {UI.card.open}
            <OpenCue>
              <Icon icon={ArrowRight} size={18} />
            </OpenCue>
          </span>
        ) : null}
      </div>
    </CardShell>
  );
}
