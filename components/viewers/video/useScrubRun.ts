'use client';

import { useEffect, useState, type RefObject } from 'react';
import { prefersTapToLoad } from '../shared/useViewerActivation';
import { runChangeHidden, scrubRunPx } from './scrub';

/**
 * The length of a scrubbed video's run (motion sheet 6.2). The stylesheet reserves one screen
 * height from the first paint (app/motion-media.css: a fine pointer, motion allowed, not paused),
 * so the page never shifts when the video arrives. Once the duration is known the run becomes
 * 100 px a second of video, held between one and three screen heights; on a slow connection, or
 * when the file does not load, it goes (`cancel`), and the video is an ordinary player.
 *
 * A new length moves only what follows the run, so it is applied only while that sits below the
 * window's foot (an IntersectionObserver on the `end` marker says when), never under the reader's
 * eyes. `spacerRef` is the run itself (its height). Returns the length to write into the run's
 * `--scrub-run`, or null for the stylesheet's own.
 */
export function useScrubRun(
  spacerRef: RefObject<HTMLElement>,
  endRef: RefObject<HTMLElement>,
  { active, duration, cancel }: { active: boolean; duration: number; cancel: boolean },
): number | null {
  const [applied, setApplied] = useState<number | null>(null);
  const [screen, setScreen] = useState(0);

  // The run is counted in screen heights: follow the window's height while the run is in use.
  useEffect(() => {
    if (!active) return undefined;
    const update = () => setScreen(window.innerHeight);
    update();
    window.addEventListener('resize', update, { passive: true });
    return () => window.removeEventListener('resize', update);
  }, [active]);

  const wanted = !active ? null : cancel ? 0 : duration > 0 && screen > 0 ? scrubRunPx(duration, screen) : null;

  useEffect(() => {
    const spacer = spacerRef.current;
    const end = endRef.current;
    if (wanted === null || wanted === applied || !spacer || !end) return undefined;
    const tryApply = (): boolean => {
      const change = wanted - spacer.offsetHeight;
      // No change moves nothing; any other waits until it cannot be seen.
      if (change !== 0 && !runChangeHidden(end.getBoundingClientRect().top, change, window.innerHeight)) return false;
      setApplied(wanted);
      return true;
    };
    if (tryApply() || !('IntersectionObserver' in window)) return undefined;
    // Wait for the end of the run to pass below the window's foot (the reader scrolled back up).
    const observer = new IntersectionObserver(() => {
      if (tryApply()) observer.disconnect();
    });
    observer.observe(end);
    return () => observer.disconnect();
  }, [applied, endRef, spacerRef, wanted]);

  return applied;
}

/**
 * True on a metered or slow connection (Save-Data, 2g, 3g), where nothing plays by itself and no
 * heavy file loads before a tap (motion sheet 8.2): the same test that makes every viewer wait for
 * a tap there. False on the server and until mount.
 */
export function useSlowConnection(): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => setSlow(prefersTapToLoad('view')), []);
  return slow;
}
