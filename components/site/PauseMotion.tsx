'use client';

import { setMotionPaused, useMotionPaused } from '@/lib/motionPause';

/**
 * The pause-motion control (docs/V3_PLAN.md D-67 and Q-38), in the footer's meta row: a plain
 * button whose words say what pressing it will do, "Pause motion" while the sky moves and "Play
 * motion" while it is paused. It carries no aria-pressed: a toggle's label must not change with its
 * state (WAI-ARIA Authoring Practices), and a screen reader would hear "Play motion, pressed" while
 * motion is paused. Pausing settles the sky to its still image at once; playing starts it again.
 * The choice is kept in this browser (lib/motionPause.ts). It is a 44 px target drawn as one line of
 * the row (app/sheet.css 23). The words come from the server (lib/strings.ts), so the site-wide
 * script chunk does not carry the strings module.
 */
export default function PauseMotion({ labels }: { labels: { pause: string; play: string } }) {
  const paused = useMotionPaused();
  return (
    <button type="button" className="ar-foot__pause" onClick={() => setMotionPaused(!paused)}>
      {paused ? labels.play : labels.pause}
    </button>
  );
}
