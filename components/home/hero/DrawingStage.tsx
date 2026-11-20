'use client';

import { useRef, useState, type ReactNode } from 'react';
import { INTRO_ATTR, INTRO_GO_ATTR, beginIntro, runIntro } from '@/lib/intro';
import { useMotionPaused } from '@/lib/motionPause';
import { useMotionOk } from '@/lib/useMotionOk';
import { useFinePointer, useIsoLayoutEffect } from './hooks';
import PointerLens from './PointerLens';
import RotorTilt from './RotorTilt';
import TouchLens from './TouchLens';

/**
 * The drawing's box (the canvas's .hm-art: 600 by 560, `touch-action: pan-y`) and the motion that
 * needs a script. The drawing itself arrives as server HTML through `children` (RavenDrawing), so
 * none of its geometry is in this bundle. What CSS does alone (app/motion-drawing.css): the final
 * state for every visitor from the first paint (the lens at rest for a mouse or a pen, no lens on
 * touch, the static split under reduced motion or with motion paused) and the load sequence's
 * stroke-in, lens fade and scan band.
 *
 * What this adds, only while motion is allowed (useMotionOk, and the footer's pause control):
 * - the rotor tilt with the hero's scroll (RotorTilt);
 * - the lens following a mouse or a pen (PointerLens, its ring then the Motion+ Cursor), or, on
 *   phones and tablets, press and drag (TouchLens).
 * Each is a leaf that renders nothing and puts the drawing back when it unmounts, so turning
 * motion off during a visit (reduced motion, the pause control) returns the rest state at once.
 *
 * On a client-side navigation to the home page it also starts the load sequence before the first
 * paint (lib/intro.ts beginIntro); on a full load the hero's two inline scripts have already done
 * that (introScript at the top of the section, introGoScript right after the svg). A drawing that
 * comes into the hero while the sequence plays (media mode, when the photo does not load:
 * ../HeroMediaFallback.tsx) never ran its go script: it gives itself the go mark as it mounts
 * (lib/intro.ts runIntro), so it strokes in from there and the sequence ends with its steps.
 */
export default function DrawingStage({ children }: { children: ReactNode }) {
  const art = useRef<HTMLDivElement>(null);
  const [boxReady, setBoxReady] = useState(false);
  const motionOk = useMotionOk();
  const paused = useMotionPaused();
  const fine = useFinePointer();
  const live = motionOk && !paused && boxReady;

  useIsoLayoutEffect(() => {
    const section = art.current?.closest<HTMLElement>('.hm-hero');
    if (section && beginIntro(section) && !section.hasAttribute(INTRO_GO_ATTR)) {
      runIntro(section, Number(section.getAttribute(INTRO_ATTR)));
    }
    // React fills `art` only once the box itself has mounted, after the layout effects of what is
    // inside it, so a leaf mounted with the box would find it empty. The leaves mount in the
    // render right after this one instead, which React runs before the first paint.
    setBoxReady(true);
  }, []);

  return (
    <div ref={art} className="hm-art">
      {children}
      {live ? <RotorTilt art={art} /> : null}
      {live && fine ? <PointerLens art={art} /> : null}
      {live && !fine ? <TouchLens art={art} /> : null}
    </div>
  );
}
