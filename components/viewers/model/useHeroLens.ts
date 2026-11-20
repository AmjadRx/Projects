'use client';

import { animate, useMotionValue, type AnimationPlaybackControls } from 'motion/react';
import {
  createElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type RefObject,
} from 'react';
import LensFollowHost, { type LensFollowHandle } from '@/components/home/hero/LensFollowHost';
import {
  FOLLOW_ATTR,
  LensFollowMachine,
  chromeClip,
  isLensPointer,
  loadLensCursor,
  type LensCursorModule,
} from '@/components/home/hero/lensFollow';
import { hero } from '@/lib/motion';
import type { ModelView } from '../types';
import type { HeroLensValues } from './engine-types';
import { clampLensCenter, lensRadius } from './orbit';

const PASSIVE = { passive: true } as const;

type Point = { x: number; y: number };

/**
 * When the lens may show over the hero model (DESIGN_DIRECTION.md 6.1; motion sheets 4.1, 4.5 and
 * 8): in the Realistic view, on a device whose pointer is fine and can hover (a mouse, a trackpad,
 * a pen), with motion allowed (not reduced, not paused), and once the engine draws the model.
 */
export function lensEnabled({
  motion,
  finePointer,
  engineReady,
  view,
}: {
  motion: boolean;
  finePointer: boolean;
  engineReady: boolean;
  view: ModelView;
}): boolean {
  return motion && finePointer && engineReady && view === 'realistic';
}

/** The lens's rest point (hero.model.lensRest, in the drawing's units) in CSS px of a `width` by `height` stage. */
export function restPoint(width: number, height: number): Point {
  return {
    x: hero.model.lensRest.x * (width / hero.drawing.width),
    y: hero.model.lensRest.y * (height / hero.drawing.height),
  };
}

export interface HeroLens {
  /** What the engine reads to draw the thermal circle (engine-types.ts HeroLensValues). */
  values: HeroLensValues;
  /** The stage's own ring in the line color over the circle's edge (app/motion-model.css .hm-model__ring). */
  ringRef: RefObject<HTMLSpanElement>;
  /** For the stage: a mouse or pen over it moves the lens. */
  handlers: {
    onPointerEnter: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerLeave: (event: ReactPointerEvent<HTMLElement>) => void;
  };
  /** Where the Motion+ Cursor mounts while the lens follows: render it anywhere (it portals to the body). */
  follow: ReactElement;
}

/**
 * The thermal lens over the hero model (DESIGN_DIRECTION.md 6.1 and 6.4; ARCHITECTURE.md 8; motion
 * sheets 4.1 and 4.5): a circle the drawing's size (orbit.ts lensRadius), shown while `enabled`
 * (lensEnabled). It rests where the Hero-1440-Realistic board draws it (hero.model.lensRest) and
 * fades in there when it may show, and out where it is when it may not (hero.model.lensFade).
 *
 * While a mouse or a pen is over the stage, the lens follows it, and its ring is the Motion+ Cursor
 * in follow mode (components/home/hero/LensCursor.tsx, through lensFollow.ts, as the drawing's
 * lens): the lens spring (hero.lens.follow), the centre kept inside the inner frame
 * (clampLensCenter). Every frame the Cursor moves, its clamped point is written to `x` and `y`,
 * which the engine's thermal pass reads, and the ring is drawn at the same centre. The engine draws
 * on its next animation frame after a change, so both rings, the Cursor's and the stage's, show
 * each centre a frame later too (LensCursor frameBehind): ring and pass are painted together, one
 * position each frame. When the pointer leaves, the stage's own ring takes over where the
 * Cursor left it and goes back to rest with the rest spring (hero.lens.back), and stays drawn
 * there. The browser's own cursor over the stage is untouched: dragging there orbits the model.
 *
 * Everything moves through motion values: the engine draws from them and the stage's ring is
 * written from them, so a moving lens never renders React. The Cursor's code loads when the lens
 * may first show.
 */
export function useHeroLens(stageRef: RefObject<HTMLElement>, enabled: boolean): HeroLens {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const opacity = useMotionValue(0);
  const radius = useMotionValue(0);
  const ringRef = useRef<HTMLSpanElement>(null);
  const host = useRef<LensFollowHandle>(null);
  const [cursor, setCursor] = useState<LensCursorModule | null>(null);
  const cursorRef = useRef<LensCursorModule | null>(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const fade = useRef<AnimationPlaybackControls | null>(null);
  const travel = useRef<AnimationPlaybackControls[]>([]);
  /** The lens is at its rest point, or on its way there: it keeps to it when the stage resizes. */
  const resting = useRef(true);
  /** The lens's centre as last written during a follow, in CSS px of the stage. */
  const last = useRef<Point>({ x: 0, y: 0 });
  const size = useRef({ width: 0, height: 0 });

  /** Puts the lens's centre at `p` at once, stopping its way back to rest. */
  const jumpTo = useCallback(
    (p: Point) => {
      for (const animation of travel.current) animation.stop();
      travel.current = [];
      x.jump(p.x);
      y.jump(p.y);
    },
    [x, y],
  );

  /** Sends the lens back to its rest point with the rest spring. */
  const goRest = useCallback(() => {
    resting.current = true;
    const target = restPoint(size.current.width, size.current.height);
    for (const animation of travel.current) animation.stop();
    travel.current = [animate(x, target.x, hero.lens.back), animate(y, target.y, hero.lens.back)];
  }, [x, y]);

  /** Ends a follow: the stage's ring takes over where the Cursor left it. `sync` from an event, not from an effect. */
  const endFollow = useCallback(
    (sync: boolean) => {
      jumpTo(last.current);
      stageRef.current?.removeAttribute(FOLLOW_ATTR);
      if (sync) host.current?.stop();
      else host.current?.clear();
    },
    [jumpTo, stageRef],
  );

  const machine = useMemo(
    () =>
      new LensFollowMachine<{ clientX: number; clientY: number }>({
        canFollow: () => enabledRef.current && cursorRef.current !== null && host.current !== null,
        start(event) {
          const stage = stageRef.current;
          const lensCursor = cursorRef.current;
          const handle = host.current;
          if (!stage || !lensCursor || !handle) return false;
          const rect = stage.getBoundingClientRect();
          if (!(rect.width > 0 && rect.height > 0)) return false;
          // The stage stays put during a follow: a scroll or a resize ends it.
          const box = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
          const at = { x: x.get(), y: y.get() };
          jumpTo(at);
          last.current = at;
          resting.current = false;
          lensCursor.setPointer(event.clientX, event.clientY);
          const side = 2 * radius.get();
          handle.start({
            start: { x: box.left + at.x, y: box.top + at.y },
            place(pointer) {
              const centre = clampLensCenter(pointer.x - box.left, pointer.y - box.top, box.width, box.height);
              x.jump(centre.x);
              y.jump(centre.y);
              last.current = centre;
              return { x: box.left + centre.x, y: box.top + centre.y };
            },
            clip: chromeClip(),
            frameBehind: true,
            children: createElement('span', {
              className: 'hm-model__ring hm-model__ring--cursor',
              style: { width: side, height: side },
              'aria-hidden': true,
            }),
          });
          stage.setAttribute(FOLLOW_ATTR, '');
          return true;
        },
        stop: () => endFollow(true),
        rest: goRest,
      }),
    [endFollow, goRest, jumpTo, radius, stageRef, x, y],
  );

  // The lens scales with the stage, never with the pointer; resting, it keeps to its rest point.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    const measure = () => {
      size.current = { width: stage.clientWidth, height: stage.clientHeight };
      radius.set(lensRadius(stage.clientWidth));
      if (resting.current) jumpTo(restPoint(size.current.width, size.current.height));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [jumpTo, radius, stageRef]);

  // The stage's ring follows the same values; its size changes only with the stage's. The engine
  // draws the thermal circle on its next animation frame after a value changes (it renders on
  // demand), so the ring is written in that frame too: the two are painted together.
  useEffect(() => {
    const ring = ringRef.current;
    if (!ring) return undefined;
    const write = () => {
      const r = radius.get();
      const side = `${2 * r}px`;
      ring.style.width = side;
      ring.style.height = side;
      ring.style.transform = `translate3d(${x.get() - r}px, ${y.get() - r}px, 0)`;
      ring.style.opacity = String(opacity.get());
    };
    let queued = 0;
    const later = () => {
      if (!queued) {
        queued = requestAnimationFrame(() => {
          queued = 0;
          write();
        });
      }
    };
    write();
    const stops = [x, y, radius, opacity].map((value) => value.on('change', later));
    return () => {
      stops.forEach((stop) => stop());
      cancelAnimationFrame(queued);
    };
  }, [opacity, radius, x, y]);

  const fadeTo = useCallback(
    (value: number) => {
      fade.current?.stop();
      fade.current = opacity.get() === value ? null : animate(opacity, value, hero.model.lensFade);
    },
    [opacity],
  );

  // Shown at rest when it may show, faded out where it is when it may not (another view, motion
  // paused, the engine gone). The Cursor's code loads the first time it may show.
  useEffect(() => {
    if (!enabled) {
      if (machine.following) {
        machine.reset();
        endFollow(false);
      }
      fadeTo(0);
      return undefined;
    }
    if (opacity.get() === 0) {
      resting.current = true;
      jumpTo(restPoint(size.current.width, size.current.height));
    }
    fadeTo(1);
    let alive = true;
    loadLensCursor().then(
      (loaded) => {
        if (!alive) return;
        loaded.primePointer();
        cursorRef.current = loaded;
        setCursor(loaded);
      },
      () => {
        // Offline or blocked: the lens rests, and no follow starts.
      },
    );
    return () => {
      alive = false;
    };
  }, [enabled, endFollow, fadeTo, jumpTo, machine, opacity]);

  // The page moving under the pointer, or the tab hidden, ends a follow: the lens stays where it was.
  useEffect(() => {
    const onMoved = () => machine.interrupt();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') machine.interrupt();
    };
    window.addEventListener('scroll', onMoved, PASSIVE);
    window.addEventListener('resize', onMoved, PASSIVE);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('scroll', onMoved);
      window.removeEventListener('resize', onMoved);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [machine]);

  useEffect(
    () => () => {
      fade.current?.stop();
      for (const animation of travel.current) animation.stop();
      machine.reset();
      stageRef.current?.removeAttribute(FOLLOW_ATTR);
    },
    [machine, stageRef],
  );

  const handlers = useMemo(() => {
    const move = (event: ReactPointerEvent<HTMLElement>) => {
      if (!isLensPointer(event.pointerType)) return;
      // Motion+ reads mice only: a pen's moves are handed to the Cursor here.
      if (event.pointerType === 'pen' && machine.following) cursorRef.current?.setPointer(event.clientX, event.clientY);
      machine.move(event);
    };
    const leave = (event: ReactPointerEvent<HTMLElement>) => {
      if (isLensPointer(event.pointerType)) machine.leave();
    };
    return { onPointerEnter: move, onPointerMove: move, onPointerLeave: leave };
  }, [machine]);

  const values = useMemo(() => ({ x, y, radius, opacity }), [opacity, radius, x, y]);
  const follow = useMemo(() => createElement(LensFollowHost, { ref: host, cursor }), [cursor]);
  return { values, ringRef, handlers, follow };
}
