'use client';

import { useRef } from 'react';
import { beginIntro, introAge } from '@/lib/intro';
import { useMotionPaused } from '@/lib/motionPause';
import { useMotionOk } from '@/lib/useMotionOk';
import { SET_ATTR, revealHeadline, revealWanted, type HeadlineReveal } from './headlineReveal';
import { useIsoLayoutEffect } from './hooks';

/**
 * The hero's headline (ARCHITECTURE.md 5; the canvas's hm-hero__title): one h1, rendered exactly as
 * before, so the server's markup and the first client render are the same. Once a visit it sets
 * line by line as the load sequence's first step (./headlineReveal.ts, on Motion+ splitText).
 *
 * The start state is CSS's: while the hero section carries data-intro, set by the section's inline
 * script before the h1 is parsed (lib/intro.ts), the h1 is hidden, and CSS sets it in place at
 * load.headline.giveUpAfter if no script has taken over (app/motion-drawing.css). This leaf takes
 * over after hydration: when the sequence plays and the give-up has not passed, it splits the h1
 * and starts the lines, then marks the h1 (data-headline-set) in the same task, so the h1's start
 * state hands over to the lines' own with nothing painted between. Otherwise it marks the h1 at
 * once and the headline is simply there. It waits for the fonts first, so the lines are measured in
 * the face they set in.
 *
 * After a client-side visit to the home page in media mode nothing else starts the sequence, so
 * this leaf calls beginIntro once, at mount, before the first paint (as DrawingStage does). Only
 * then: a visit that loaded with motion off never plays the sequence, so turning motion on later
 * starts nothing. Turning motion off during the reveal (reduced motion, the pause control) ends it
 * at once in its final state, and turning motion back on leaves it there.
 */
export default function Headline({ text }: { text: string }) {
  const ref = useRef<HTMLHeadingElement>(null);
  const motionOk = useMotionOk();
  const paused = useMotionPaused();
  const motion = motionOk && !paused;
  /** The `motion` the reveal's effect last ran with; null before its first run. */
  const lastMotion = useRef<boolean | null>(null);

  // Declared before the reveal's effect, so the sequence's mark is in place when that one reads it.
  useIsoLayoutEffect(() => {
    const section = ref.current?.closest<HTMLElement>('.hm-hero');
    if (section) beginIntro(section);
  }, []);

  useIsoLayoutEffect(() => {
    // Motion that comes back on while the sequence still plays (media mode keeps its mark until
    // load.end) finds the headline already set, and leaves it set.
    const resumed = motion && lastMotion.current === false;
    lastMotion.current = motion;
    const h1 = ref.current;
    const section = h1?.closest<HTMLElement>('.hm-hero');
    if (!h1 || !section) return undefined;
    const play = motion && !resumed;
    let reveal: HeadlineReveal | null = null;
    let live = true;
    const begin = () => {
      if (!live) return;
      if (play && revealWanted(introAge(section))) reveal = revealHeadline(h1);
      h1.setAttribute(SET_ATTR, '');
    };
    const fonts = typeof document.fonts === 'object' ? document.fonts : null;
    if (play && revealWanted(introAge(section)) && fonts?.status === 'loading') void fonts.ready.then(begin, begin);
    else begin();
    return () => {
      live = false;
      reveal?.stop();
    };
  }, [motion]);

  return (
    <h1 ref={ref} className="hm-hero__title" id="hero-title">
      {text}
    </h1>
  );
}
