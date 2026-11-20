'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import { INTRO_ATTR, introPlaying } from '@/lib/intro';
import { hero } from '@/lib/motion';
import { createLens } from './lens';
import LensFollowHost, { type LensFollowHandle } from './LensFollowHost';
import {
  FOLLOW_ATTR,
  LensFollowMachine,
  afterIdle,
  chromeClip,
  isLensPointer,
  loadLensCursor,
  type LensCursorModule,
} from './lensFollow';
import { VIEW, clampToFrame, fromDrawing, lensBox, lensTicks, toDrawing, type Point } from './raven';

const LENS_R = hero.lens.radius;
const PASSIVE = { passive: true } as const;

/**
 * The lens's ring as the Cursor draws it: the drawing's own circle and ticks (.hm-lens) at the
 * drawing's scale, with the stroke the drawing's ring has now (it is wider on narrow frames, a
 * container query the Cursor, portalled outside the frame, cannot see).
 */
function CursorRing({ scale, stroke }: { scale: number; stroke: string }) {
  const half = lensBox(LENS_R);
  const side = 2 * half * scale;
  const width = stroke ? { strokeWidth: stroke } : undefined;
  return (
    <svg className="hd-cursor-ring" width={side} height={side} viewBox={`${-half} ${-half} ${2 * half} ${2 * half}`} aria-hidden="true" focusable="false">
      <circle className="hm-lens" r={LENS_R} style={width} />
      <path className="hm-lens" d={lensTicks(LENS_R)} style={width} />
    </svg>
  );
}

/**
 * The desktop lens's pointer driver (DESIGN_DIRECTION.md 6.1 and 6.4; ARCHITECTURE.md 8; motion
 * sheet 4.1), for a mouse or a pen. While the pointer is over the drawing, the lens's ring is the
 * Motion+ Cursor in follow mode (./LensCursor.tsx, through ./lensFollow.ts): it follows with the
 * lens spring (hero.lens.follow), its centre kept inside the inner frame (hero.lens.frame), and the
 * cursor becomes the lens (app/motion-drawing.css hides the browser's cursor over the drawing while
 * it follows, and nowhere else). Every frame the Cursor moves, its point is clamped and written to
 * the thermal layer's clip (createLens jumpTo), and the ring is drawn at that same centre, so the
 * ring and the thermal view never part. When the pointer leaves, the drawing's own ring takes over
 * where the Cursor left it and goes back to rest over the battery bay with the rest spring
 * (hero.lens.back), and stays drawn there, as the Hero boards show.
 *
 * The Cursor's code is not in the first load: it loads once the load sequence has ended (the lens
 * appears only after the strokes), in an idle moment, or at once when a mouse or a pen first comes
 * over the drawing (hero.lens.load). No follow starts while the sequence plays. Until the code is
 * in, the lens rests.
 *
 * DrawingStage mounts this only for a fine pointer with motion allowed; unmounting puts the drawing
 * back as the server sent it (the lens at rest), and React takes the Cursor away with it.
 */
export default function PointerLens({ art }: { art: RefObject<HTMLDivElement> }) {
  const [cursor, setCursor] = useState<LensCursorModule | null>(null);
  const cursorRef = useRef<LensCursorModule | null>(null);
  const host = useRef<LensFollowHandle>(null);

  // The Cursor's code, when it is first needed.
  useEffect(() => {
    const root = art.current;
    if (!root) return;
    const section = root.closest<HTMLElement>('.hm-hero');
    let alive = true;
    let asked = false;
    let cancelIdle: (() => void) | null = null;
    let watcher: MutationObserver | null = null;

    const load = () => {
      if (asked) return;
      asked = true;
      watcher?.disconnect();
      cancelIdle?.();
      root.removeEventListener('pointerover', load);
      loadLensCursor().then(
        (loaded) => {
          if (!alive) return;
          loaded.primePointer();
          cursorRef.current = loaded;
          setCursor(loaded);
        },
        () => {
          // Offline or blocked: the lens keeps resting over the battery bay.
        },
      );
    };
    const loadWhenIdle = () => {
      if (!asked && !cancelIdle) cancelIdle = afterIdle(load, hero.lens.load);
    };

    root.addEventListener('pointerover', load, PASSIVE);
    if (section && introPlaying(section)) {
      watcher = new MutationObserver(() => {
        if (!introPlaying(section)) loadWhenIdle();
      });
      watcher.observe(section, { attributes: true, attributeFilter: [INTRO_ATTR] });
    } else {
      loadWhenIdle();
    }
    return () => {
      alive = false;
      watcher?.disconnect();
      cancelIdle?.();
      root.removeEventListener('pointerover', load);
    };
  }, [art]);

  useEffect(() => {
    const root = art.current;
    if (!root) return;
    const section = root.closest<HTMLElement>('.hm-hero');
    const lens = createLens(root);
    /** The lens's centre as last written, in drawing units: where the drawing's ring takes over. */
    let last: Point = lens.position();

    const machine = new LensFollowMachine<PointerEvent>({
      canFollow: () => cursorRef.current !== null && host.current !== null && !introPlaying(section),
      start(event) {
        const lensCursor = cursorRef.current;
        const handle = host.current;
        const rect = root.getBoundingClientRect();
        if (!lensCursor || !handle || !(rect.width > 0 && rect.height > 0)) return false;
        // The box stays put during a follow: a scroll or a resize ends it.
        const box = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
        last = lens.position();
        lens.jumpTo(last);
        const ring = root.querySelector<SVGElement>('.hd-ring .hm-lens');
        const stroke = ring ? window.getComputedStyle(ring).strokeWidth : '';
        lensCursor.setPointer(event.clientX, event.clientY);
        handle.start({
          start: fromDrawing(last, box),
          place(pointer) {
            last = clampToFrame(toDrawing(pointer.x, pointer.y, box));
            lens.jumpTo(last);
            return fromDrawing(last, box);
          },
          clip: chromeClip(),
          children: <CursorRing scale={box.width / VIEW.width} stroke={stroke} />,
        });
        root.setAttribute(FOLLOW_ATTR, '');
        return true;
      },
      stop() {
        lens.jumpTo(last);
        root.removeAttribute(FOLLOW_ATTR);
        host.current?.stop();
      },
      rest() {
        lens.springTo(hero.lens.rest, hero.lens.back);
      },
    });

    const onMove = (event: PointerEvent) => {
      if (!isLensPointer(event.pointerType)) return;
      // Motion+ reads mice only: a pen's moves are handed to the Cursor here.
      if (event.pointerType === 'pen' && machine.following) cursorRef.current?.setPointer(event.clientX, event.clientY);
      machine.move(event);
    };
    const onLeave = (event: PointerEvent) => {
      if (isLensPointer(event.pointerType)) machine.leave();
    };
    const onMoved = () => machine.interrupt();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') machine.interrupt();
    };

    root.addEventListener('pointerenter', onMove, PASSIVE);
    root.addEventListener('pointermove', onMove, PASSIVE);
    root.addEventListener('pointerleave', onLeave, PASSIVE);
    window.addEventListener('scroll', onMoved, PASSIVE);
    window.addEventListener('resize', onMoved, PASSIVE);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      root.removeEventListener('pointerenter', onMove);
      root.removeEventListener('pointermove', onMove);
      root.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('scroll', onMoved);
      window.removeEventListener('resize', onMoved);
      document.removeEventListener('visibilitychange', onVisibility);
      machine.reset();
      root.removeAttribute(FOLLOW_ATTR);
      lens.destroy();
    };
  }, [art]);

  return <LensFollowHost ref={host} cursor={cursor} />;
}
