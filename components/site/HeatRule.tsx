'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useMotionPaused } from '@/lib/motionPause';
import { useMotionOk } from '@/lib/useMotionOk';
import { heatTransforms } from './chromeMotion';
import { usePageProgress } from './usePageProgress';

/** True where CSS ties the heat rule to scroll itself (the @supports block in app/motion-chrome.css). */
function cssScrollTimeline(): boolean {
  return typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('animation-timeline: scroll()');
}

/**
 * The heat rule (DESIGN_DIRECTION.md 2.4, the ramp's place 3; motion sheet 7.1): a 2 px line along
 * the foot of the nav whose length is the page progress, linked to scroll with no lag, over the
 * thermal ramp fixed to the page width, so it runs cold to hot as the page is read.
 *
 *   div.ar-heat           the line's box along the nav's foot, clipping
 *     div.ar-heat__bar    the window: slides in from the left by the progress
 *       div.ar-heat__fill the ramp: slides back by as much, so it stays on the page width
 *
 * Where the browser has scroll-driven animations, CSS ties both translations to the page's scroll
 * on the compositor (app/motion-chrome.css); elsewhere Motion's scroll progress writes them to the
 * two elements' style, never through React state. Under reduced motion it is not drawn (sheet 8.1),
 * nor while the visitor has paused motion (D-67): the stylesheet hides it from the first paint, and
 * the hooks hide it after hydration whenever motion may not play. Decorative, so hidden from
 * assistive technology.
 */
export default function HeatRule() {
  const motionOk = useMotionOk();
  const paused = useMotionPaused();
  const ok = motionOk && !paused;
  const bar = useRef<HTMLDivElement>(null);
  const fill = useRef<HTMLDivElement>(null);
  const byScript = useRef(false);

  const write = useCallback((progress: number) => {
    if (!byScript.current) return;
    const { bar: barTransform, fill: fillTransform } = heatTransforms(progress);
    if (bar.current) bar.current.style.transform = barTransform;
    if (fill.current) fill.current.style.transform = fillTransform;
  }, []);

  const read = usePageProgress(write);

  useEffect(() => {
    if (cssScrollTimeline()) return undefined;
    byScript.current = true;
    write(read());
    return () => {
      byScript.current = false;
    };
  }, [read, write]);

  return (
    <div className="ar-heat" aria-hidden="true" hidden={!ok}>
      <div ref={bar} className="ar-heat__bar">
        <div ref={fill} className="ar-heat__fill" />
      </div>
    </div>
  );
}
