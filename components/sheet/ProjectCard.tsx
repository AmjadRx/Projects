import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { domainKey, hasText, projectDomains, statusText } from '@/lib/format';
import type { ResolvedMedia } from '@/lib/media';
import { resolveMedia } from '@/lib/media-server';
import { UI } from '@/lib/strings';
import type { Project } from '@/lib/types';
import { cn } from '@/lib/utils';
import CoverImage from './CoverImage';
import DimensionCallouts from './DimensionCallouts';
import Icon from './Icon';
import MaturityScale from './MaturityScale';

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

/**
 * A cover that is a video or a model (bundle cards.jsx, bundle.css 28), at rest: its poster, or the
 * bare night well when it has none, with its kind on a tag. It does not play or turn until
 * Phase 5, and a card never offers sound or orbiting.
 */
function StillCover({ cover, sizes, priority }: { cover: ResolvedMedia; sizes: string; priority: boolean }) {
  const kind = cover.kind === 'model' ? UI.card.model : cover.kind === 'video' || cover.kind === 'embed' ? UI.card.video : '';
  return (
    <div className="ar-well ar-card__motion">
      {cover.poster ? (
        <CoverImage
          src={cover.poster.src}
          alt={cover.alt}
          focal={cover.focal}
          sizes={sizes}
          priority={priority}
          labels={{ didNotLoad: UI.placeholder.didNotLoad, tryAgain: UI.placeholder.tryAgain }}
        />
      ) : null}
      {kind ? <span className="ar-card__kind">{kind}</span> : null}
    </div>
  );
}

/**
 * A project card (bundle ProjectCard, bundle.css 17; DESIGN_DIRECTION.md 5.8): the cover in a 16:10
 * well, the title, the one-line pitch, the maturity scale, and the status. No tags. The title's
 * link is stretched over the whole card, so the card is one link with the focus ring around it.
 *
 * - regular: glass with a rule border (a soft shadow in Whiteprint), the compact maturity scale.
 * - featured: from 1024 px full width with the cover on 7 columns and the text on 5, a 28 px title,
 *   the full scale, and an "Open project" cue.
 * - Hover turns the border to the line color and shows the callouts over a photo cover (no motion
 *   and no tilt until Phase 5); phones show no callouts, because nothing depends on hover.
 * - No photo: "Photo to come"; a photo that fails: "Photo did not load", with no Try again.
 * - The status prints unless it repeats the maturity label; with no `statusLabel` it is the
 *   `status` value in sentence case (docs/V3_PLAN.md Q-12).
 *
 * `data-card` and `data-domains` let the domain filter hide a card without script.
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
  const domains = projectDomains(project).map(domainKey).filter(Boolean);
  const maturity = project.maturity && hasText(project.maturity.label) ? project.maturity : null;
  const status = statusText(project);
  const showStatus = hasText(status) && (!maturity || status.trim() !== maturity.label.trim());

  return (
    <article className={cn('ar-card', `ar-card--${variant}`, className)} data-card data-domains={domains.join(' ')}>
      <div className="ar-card__cover">
        {cover && cover.kind !== 'image' ? (
          <StillCover cover={cover} sizes={coverSizes} priority={priority} />
        ) : (
          <DimensionCallouts
            media={cover}
            callouts={project.callouts}
            layout="over"
            retry={false}
            sizes={coverSizes}
            priority={priority}
          />
        )}
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
            <Icon icon={ArrowRight} size={18} />
          </span>
        ) : null}
      </div>
    </article>
  );
}
