'use client';

import { useRouter } from 'next/navigation';
import { LazyMotion, useMotionValue, useSpring, useTransform } from 'motion/react';
import * as m from 'motion/react-m';
import { useMemo, useRef, useState, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
import { useFinePointer } from '@/components/viewers/shared/hooks';
import { isPlainClick, tiltToward } from '@/lib/cardMotion';
import { openProject } from '@/lib/cardTransition';
import { cards } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { CardProvider, useCardMotion } from './cardContext';
import { animationFeatures } from './lazyMotion';

const tiltSpring = { visualDuration: cards.tilt.spring.visualDuration, bounce: cards.tilt.spring.bounce };
const glintSpring = { visualDuration: cards.highlight.spring.visualDuration, bounce: cards.highlight.spring.bounce };

/** A mouse or a pen on a device whose main pointer can hover: the only input a card answers. */
function answers(event: PointerEvent, fine: boolean): boolean {
  return fine && (event.pointerType === 'mouse' || event.pointerType === 'pen');
}

/**
 * The browser half of a project card (motion sheet 5; DESIGN_DIRECTION.md 5.8 and 6.3): the card's
 * glass, which answers a mouse or a pen and nothing else. An untransformed frame around the card
 * takes the pointer, so a tilt never pulls the card out from under it at an edge.
 *
 * - Tilt: the card turns toward the pointer about its centre, up to 4 degrees (2 on the featured
 *   card) with a 1000 px perspective, through the tilt spring in and back. The pose lives in motion
 *   values, so a pointer move renders nothing; at rest the card has no transform at all.
 * - Highlight: a 1 px light in the line color runs along the rim of the glass, centred on the
 *   pointer and masked to the border so it never crosses the text, following the pointer through
 *   the same spring; it fades in and out in 200 ms (app/motion-cards.css draws it).
 * - Hover is shared with the pieces inside (cardContext): the callouts draw, a video cover plays, a
 *   model cover turns, the "Open project" arrow nudges. Touch and keyboard focus never tilt a card
 *   or draw its callouts; under reduced motion, or while motion is paused, there is no tilt and no
 *   highlight, and the callouts show at once.
 * - Press resets the tilt at once (docs/V3_PLAN.md D-54), so the cover leaves the card flat.
 * - Open: a plain click on the card's link opens the project with the card-to-page transition
 *   (lib/cardTransition.ts); every other click, and every browser without View Transitions, follows
 *   the link as it is.
 */
export default function CardShell({
  variant,
  slug,
  domains,
  className,
  children,
}: {
  variant: 'regular' | 'featured';
  slug: string;
  /** The card's domain keys, space-separated (data-domains). */
  domains: string;
  className?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const motionOk = useCardMotion();
  const fine = useFinePointer();
  const [hovered, setHovered] = useState(false);
  const hoveredRef = useRef(false);
  const max = variant === 'featured' ? cards.tilt.featured : cards.tilt.max;

  const rotateX = useMotionValue(0);
  const rotateY = useMotionValue(0);
  const tiltX = useSpring(rotateX, tiltSpring);
  const tiltY = useSpring(rotateY, tiltSpring);
  const transform = useTransform([tiltX, tiltY], ([x, y]: number[]) =>
    x === 0 && y === 0 ? 'none' : `perspective(${cards.tilt.perspective}px) rotateX(${x}deg) rotateY(${y}deg)`,
  );
  const pointX = useMotionValue(0);
  const pointY = useMotionValue(0);
  const glintX = useSpring(pointX, glintSpring);
  const glintY = useSpring(pointY, glintSpring);

  const hover = (on: boolean) => {
    if (hoveredRef.current === on) return;
    hoveredRef.current = on;
    setHovered(on);
  };

  const rest = () => {
    rotateX.set(0);
    rotateY.set(0);
  };

  /** Poses the card for the pointer; on entering, the light starts where the pointer is. */
  const follow = (event: PointerEvent<HTMLElement>, entering: boolean) => {
    const card = event.currentTarget;
    const pose = tiltToward(event.clientX, event.clientY, card.getBoundingClientRect(), max);
    rotateX.set(pose.rotateX);
    rotateY.set(pose.rotateY);
    const x = pose.fx * card.offsetWidth;
    const y = pose.fy * card.offsetHeight;
    if (entering) {
      pointX.jump(x);
      pointY.jump(y);
      glintX.jump(x);
      glintY.jump(y);
    } else {
      pointX.set(x);
      pointY.set(y);
    }
  };

  const onPointerEnter = (event: PointerEvent<HTMLElement>) => {
    if (!answers(event, fine)) return;
    hover(true);
    if (motionOk) follow(event, true);
  };

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    if (!answers(event, fine)) return;
    // A card that appeared under a resting pointer gets no enter event: the first move counts.
    const entering = !hoveredRef.current;
    hover(true);
    // While a button is held (a press, a text selection) the card stays as it is.
    if (motionOk && event.buttons === 0) follow(event, entering);
  };

  const onPointerLeave = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType === 'touch') return;
    hover(false);
    rest();
  };

  const onPointerDown = () => {
    rotateX.jump(0);
    rotateY.jump(0);
    tiltX.jump(0);
    tiltY.jump(0);
  };

  const onClickCapture = (event: MouseEvent<HTMLElement>) => {
    if (!isPlainClick(event)) return;
    const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!(link instanceof HTMLAnchorElement) || !event.currentTarget.contains(link)) return;
    if ((link.target && link.target !== '_self') || link.hasAttribute('download')) return;
    const url = new URL(link.href, window.location.href);
    if (url.origin !== window.location.origin) return;
    const opened = openProject({
      card: event.currentTarget,
      href: `${url.pathname}${url.search}${url.hash}`,
      slug,
      push: (href) => router.push(href),
    });
    // Next's Link sees the handled click and stands aside; otherwise it navigates as usual.
    if (opened) event.preventDefault();
  };

  /**
   * A tilted card stands a few px inside its frame at the edge that turns away. A plain click in
   * that sliver lands on the frame, not the card: it opens the card all the same.
   */
  const onClick = (event: MouseEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget || !isPlainClick(event)) return;
    event.currentTarget.querySelector<HTMLAnchorElement>('a.ar-card__link')?.click();
  };

  const lit = hovered && motionOk;
  const state = useMemo(() => ({ hovered }), [hovered]);

  // The frame takes the pointer and never moves, so a tilt never pulls the card out from under it.
  return (
    <CardProvider value={state}>
      <LazyMotion features={animationFeatures}>
        <div
          className={cn('ar-card-frame', className)}
          onPointerEnter={onPointerEnter}
          onPointerMove={onPointerMove}
          onPointerLeave={onPointerLeave}
          onPointerCancel={onPointerLeave}
          onPointerDown={onPointerDown}
          onClickCapture={onClickCapture}
          onClick={onClick}
        >
          <m.article className={cn('ar-card', `ar-card--${variant}`)} data-card="" data-domains={domains} style={{ transform }}>
            {children}
            <m.span
              className="ar-card__rim"
              aria-hidden="true"
              initial={false}
              animate={{ opacity: lit ? 1 : 0 }}
              transition={{ duration: lit ? cards.highlight.in : cards.highlight.out, ease: cards.highlight.ease }}
            >
              <m.span className="ar-card__glint" style={{ x: glintX, y: glintY }} />
            </m.span>
          </m.article>
        </div>
      </LazyMotion>
    </CardProvider>
  );
}
