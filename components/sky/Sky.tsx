'use client';

import { useMotionValueEvent, useScroll, useTransform } from 'motion/react';
import { useEffect, useRef, type CSSProperties } from 'react';
import { SKY, skyFiles, toMs } from '@/lib/motion';
import { PROJECTION, projScale } from '@/lib/sky/astro';
import { STILL_FALLBACK_STEP } from '@/lib/sky/still-steps';
import { STILL_CLASSES, blueprintStillUrl, stillVar } from '@/lib/theme';
import { motionOk, subscribeMotionOk } from '@/lib/useMotionOk';
import { startSkyHost } from './host';

/** `settings.background`: the live sky, the flat drawing grid, or the plain sheet. */
export type SkyBackground = 'sky' | 'grid' | 'off';

/** A number for a custom property, to six decimals. */
const css = (n: number) => String(Number(n.toFixed(6)));

/**
 * Where each class's still image goes (app/sheet.css 23 places it), in units of the projection
 * scale `k`: its width, its height and its horizon's distance from its top over the scale it was
 * drawn at (projScale of its size; the horizon rounded as the scene rounds it), and the share of
 * it below the horizon.
 */
const STILL_GEOMETRY = Object.fromEntries(
  STILL_CLASSES.flatMap((widthClass) => {
    const { width, height } = skyFiles.stills[widthClass];
    const horizon = Math.round(height * SKY.horizon);
    const k = projScale(width, horizon);
    const name = stillVar(widthClass);
    return [
      [`${name}-w`, css(width / k)],
      [`${name}-h`, css(height / k)],
      [`${name}-hy`, css(horizon / k)],
      [`${name}-ground`, css((height - horizon) / height)],
    ];
  }),
);

/**
 * The numbers the stylesheet reads (app/sheet.css 23), from lib/motion.ts and lib/sky/astro.ts:
 * the dawn's opacity at the top and at the end of a page, the live layer's fade, the horizon's
 * height, projScale's three bounds per px of the window (the height ones through the horizon), and
 * the stills' geometry.
 */
const SKY_STYLE = {
  '--sky-dawn-min': String(SKY.dawnMin),
  '--sky-dawn-max': String(SKY.dawnMax),
  '--sky-fade': `${toMs(SKY.liveFade.duration)}ms`,
  '--sky-hz': css(SKY.horizon),
  '--sky-k-h': css(PROJECTION.top * SKY.horizon),
  '--sky-k-w': css(PROJECTION.wide),
  '--sky-k-c': css(PROJECTION.cap * SKY.horizon),
  ...STILL_GEOMETRY,
} as CSSProperties;

/**
 * The server's Blueprint still for each width class, at the fixed step STILL_FALLBACK_STEP: the
 * stylesheet falls back to it when the head script (lib/theme.ts) has not set the visitor's step.
 */
const STILL_STYLE = Object.fromEntries(
  STILL_CLASSES.map((widthClass) => [
    `${stillVar(widthClass)}-fallback`,
    `url("${blueprintStillUrl(widthClass, STILL_FALLBACK_STEP)}")`,
  ]),
) as CSSProperties;

/** True where CSS can tie the dawn to scroll itself (the @supports block in app/sheet.css 23). */
function cssScrollTimeline(): boolean {
  return typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('animation-timeline: scroll()');
}

/** The dawn's opacity on its layer; under reduced motion it holds at the top-of-page strength. */
function setDawn(layer: HTMLElement | null, opacity: number): void {
  if (layer) layer.style.opacity = String(motionOk() ? opacity : SKY.dawnMin);
}

/**
 * The page background (Phase 5; ARCHITECTURE.md 6A; motion sheet 3): one fixed layer the size of
 * the viewport behind everything in the frame, aria-hidden and never a pointer target. It replaces
 * Phase 4's static backdrop and is rendered by components/site/SiteChrome, so it is mounted once in
 * app/(site)/layout.tsx and survives route changes (and in app/not-found.tsx); never on /admin.
 *
 * - `sky`: the layers below. The still paints first, in every tier; the live scene fades in over
 *   it once loaded (./host.ts); the dawn sits over both.
 * - `grid`: the flat drawing grid; `off`: the plain sheet color. Neither loads a still or the scene.
 */
export default function Sky({ background }: { background: SkyBackground }) {
  if (background === 'sky') return <SkyLayers />;
  return <div className="ar-sky ar-sky--fixed" data-background={background} aria-hidden="true" />;
}

/**
 *   div.ar-sky.ar-sky--fixed[data-background=sky]
 *     div.ar-sky__still   the pre-rendered still, a CSS background chosen by the head script's step
 *     div.ar-sky__live    the live scene's canvases; fades in with .is-ready
 *     div.ar-sky__dawn    the thermal ramp on the horizon (Blueprint), its opacity tied to scroll
 *     div.ar-sky__labels  the drafting lines and the star name, above the dawn (Full tier)
 *
 * The dawn follows scroll in CSS where the browser has scroll-driven animations; elsewhere Motion's
 * scroll progress is written to the layer's style, never through React state.
 *
 * Motion's useScroll measures on scroll and resize events only. Its trackContentSize option is
 * left off on purpose: it reads the page's scroll size on every animation frame for as long as the
 * sky is mounted, so the page would never rest (sheet 1.1 and 8: nothing runs at rest or under
 * reduced motion). A change in the page's length shows at the next scroll; a route change scrolls
 * to the top and so is measured at once.
 */
function SkyLayers() {
  const root = useRef<HTMLDivElement>(null);
  const live = useRef<HTMLDivElement>(null);
  const dawn = useRef<HTMLDivElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  const dawnByScript = useRef(false);
  const { scrollYProgress } = useScroll();
  const dawnOpacity = useTransform(scrollYProgress, [0, 1], [SKY.dawnMin, SKY.dawnMax]);

  useMotionValueEvent(dawnOpacity, 'change', (opacity) => {
    if (dawnByScript.current) setDawn(dawn.current, opacity);
  });

  useEffect(() => {
    if (cssScrollTimeline()) return;
    dawnByScript.current = true;
    const write = () => setDawn(dawn.current, dawnOpacity.get());
    write();
    const stop = subscribeMotionOk(write);
    return () => {
      dawnByScript.current = false;
      stop();
    };
  }, [dawnOpacity]);

  useEffect(() => {
    if (!root.current || !live.current) return;
    return startSkyHost(
      { root: root.current, live: live.current, labels: labels.current ?? undefined },
      { getProgress: () => scrollYProgress.get() },
    );
  }, [scrollYProgress]);

  return (
    <div ref={root} className="ar-sky ar-sky--fixed" data-background="sky" aria-hidden="true" style={SKY_STYLE}>
      <div className="ar-sky__still" style={STILL_STYLE} />
      <div ref={live} className="ar-sky__live" />
      <div ref={dawn} className="ar-sky__dawn" />
      <div ref={labels} className="ar-sky__labels" />
    </div>
  );
}
