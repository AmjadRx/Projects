'use client';

import { useEffect, useRef, useState, type ComponentType } from 'react';
import { page } from '@/lib/motion';
import { useMotionPaused } from '@/lib/motionPause';
import { saveDataOn } from '@/lib/sky/tier';
import { useMotionOk } from '@/lib/useMotionOk';
import type { MovingTickerProps } from './MovingTicker';
import { useBrowserLayoutEffect, useFrameWidth, useNearView } from './nearView';

/**
 * The tools strip's box (ARCHITECTURE.md 5: "one Ticker"; motion sheet 7.7). The server draws the
 * still row: every tool in content order, one line that scrolls sideways, a labelled region that
 * takes focus so the keyboard can scroll it too. That row stays wherever the strip does not move by
 * itself: under reduced motion, with motion paused, with Save-Data on (sheet 8.2), without scripts,
 * and on a phone, which has no hover to pause it, so the thumb drags the row (the canvas's
 * home.css).
 *
 * From a 768 px frame, with motion allowed, the moving ticker (./MovingTicker.tsx, Motion+ Ticker)
 * takes the row's place: its code starts to load once the strip is within page.ticker.load window
 * heights of the view, never in the first load. Since a mounted Ticker asks for every frame even at
 * rest, it is mounted only once the strip is within page.ticker.near of the view and gives way to
 * the still row again beyond page.ticker.far. Both have the same height and the same words, and the
 * moving one starts at the start of the list, where the still row stands, so nothing shifts when
 * one takes the other's place, even in view; focus inside the strip stays inside it.
 */
export default function TickerStrip({ labels, labelledBy }: { labels: string[]; labelledBy: string }) {
  const box = useRef<HTMLDivElement>(null);
  const motionOk = useMotionOk();
  const paused = useMotionPaused();
  const [saveData, setSaveData] = useState(false);
  const frameWidth = useFrameWidth(box);
  const allowed = motionOk && !paused && !saveData && frameWidth !== null && frameWidth >= page.ticker.minWidth && labels.length > 0;
  const [Moving, setMoving] = useState<ComponentType<MovingTickerProps> | null>(null);
  const coming = useNearView(box, page.ticker.load, page.ticker.load, allowed && Moving === null);
  const near = useNearView(box, page.ticker.near, page.ticker.far, allowed);
  const shown = useRef(false);
  const carry = useRef(false);

  useEffect(() => setSaveData(saveDataOn(window)), []);

  useEffect(() => {
    if (!allowed || !coming || Moving) return undefined;
    let live = true;
    import('./MovingTicker').then(
      (mod) => {
        if (live) setMoving(() => mod.default);
      },
      () => {
        // The still row stays: it holds every tool, and the page loses nothing.
      },
    );
    return () => {
      live = false;
    };
  }, [allowed, coming, Moving]);

  const moving = allowed && near && Moving !== null;

  // Focus inside the strip stays inside it when the moving and the still row trade places. Whether
  // it is there is read as they trade, while the old row is still in the page.
  if (shown.current !== moving) {
    shown.current = moving;
    carry.current = box.current?.contains(document.activeElement) ?? false;
  }
  useBrowserLayoutEffect(() => {
    if (!carry.current) return;
    carry.current = false;
    box.current?.querySelector<HTMLElement>('.hm-ticker__view')?.focus({ preventScroll: true });
  }, [moving]);

  return (
    <div ref={box} className="hm-ticker ar-glassy">
      {moving && Moving ? (
        <Moving labels={labels} labelledBy={labelledBy} />
      ) : (
        <div className="hm-ticker__view" tabIndex={0} role="region" aria-labelledby={labelledBy}>
          <ul className="hm-ticker__list">
            {labels.map((label, i) => (
              <li key={`${label}-${i}`}>{label}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
