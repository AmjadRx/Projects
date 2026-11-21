'use client';

import { useEffect, useRef, type CSSProperties } from 'react';
import type { SkyController } from '@/components/sky/live';

/**
 * The client half of the sky's harness (app/dev-sky/page.tsx): it loads the live scene the way the
 * host does (a dynamic import, so three.js stays out of the page's own JavaScript) and mounts it
 * alone in a box of the requested size, over the page background of the requested theme (in
 * Whiteprint the paper and its flat grid show through the transparent sky).
 *
 * In still mode it draws one frame through renderStill(time) and sets window.__skyStill to 'ready'
 * once that frame has been presented, or to 'error:<reason>'. In live mode it starts the loop and
 * stands in for the host's inputs: the pointer, a click for the ripple, and the page's scroll (a
 * tall spacer) or a fixed progress. Dev only: window.__sky is the controller and window.__skyFps
 * the last frame rate it reported.
 */
export interface HarnessProps {
  theme: 'blueprint' | 'whiteprint';
  tier: 'full' | 'light';
  width: number | null;
  height: number | null;
  time: number | null;
  still: boolean;
  progress: number | null;
  pointer: [number, number] | null;
  ripple: [number, number] | null;
}

declare global {
  interface Window {
    __skyStill?: string;
    __skyReady?: boolean;
    __skyFps?: number;
    __sky?: SkyController;
    /** Milliseconds spent loading the data, in createSky with setSize, and in the still frame. */
    __skyTiming?: { load: number; create: number; still?: number; createdAt: number };
  }
}

export default function SkyHarness({ theme, tier, width, height, time, still, progress, pointer, ripple }: HarnessProps) {
  const box = useRef<HTMLDivElement>(null);
  const pointerX = pointer ? pointer[0] : null;
  const pointerY = pointer ? pointer[1] : null;
  const rippleX = ripple ? ripple[0] : null;
  const rippleY = ripple ? ripple[1] : null;

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const root = document.documentElement;
    const previousTheme = root.getAttribute('data-theme');
    root.setAttribute('data-theme', theme);
    window.__skyStill = undefined;
    window.__skyReady = false;

    let controller: SkyController | null = null;
    let cancelled = false;
    let presented = 0;
    const listeners: [EventTarget, string, EventListener][] = [];
    const listen = (target: EventTarget, type: string, fn: EventListener) => {
      target.addEventListener(type, fn, { passive: true });
      listeners.push([target, type, fn]);
    };
    const sizeNow = (): [number, number] => [width ?? window.innerWidth, height ?? window.innerHeight];
    const scrolled = () => {
      const max = root.scrollHeight - window.innerHeight;
      return max > 0 ? window.scrollY / max : 0;
    };
    const fail = (reason: string) => {
      window.__skyStill = `error:${reason}`;
    };

    import('@/components/sky/live')
      .then(async (live) => {
        const t0 = performance.now();
        const data = await live.loadSkyData(tier);
        if (cancelled) return;
        const t1 = performance.now();
        const start = time ?? Date.now();
        const sky = live.createSky(el, data, {
          theme,
          tier,
          startTimeMs: start,
          getProgress: () => progress ?? scrolled(),
          onReady: () => {
            window.__skyReady = true;
          },
          onFps: (fps) => {
            window.__skyFps = fps;
          },
          onError: fail,
          still,
        });
        controller = sky;
        window.__sky = sky;
        sky.setSize(...sizeNow());
        const t2 = performance.now();
        window.__skyTiming = { load: t1 - t0, create: t2 - t1, createdAt: t2 };
        if (still) {
          sky.renderStill(start);
          window.__skyTiming.still = performance.now() - t2;
          presented = requestAnimationFrame(() => {
            presented = 0;
            if (!window.__skyStill) window.__skyStill = 'ready';
          });
          return;
        }
        if (pointerX !== null && pointerY !== null) sky.setPointer({ x: pointerX, y: pointerY });
        if (rippleX !== null && rippleY !== null) sky.ripple(rippleX, rippleY);
        listen(window, 'pointermove', (e) => {
          const p = e as PointerEvent;
          sky.setPointer({ x: p.clientX, y: p.clientY });
        });
        listen(root, 'pointerleave', () => sky.setPointer(null));
        listen(window, 'pointerdown', (e) => {
          const p = e as PointerEvent;
          sky.ripple(p.clientX, p.clientY);
        });
        listen(window, 'resize', () => sky.setSize(...sizeNow()));
        sky.start();
      })
      .catch((e: unknown) => fail(e instanceof Error ? e.message : String(e)));

    return () => {
      cancelled = true;
      if (presented) cancelAnimationFrame(presented);
      for (const [target, type, fn] of listeners) target.removeEventListener(type, fn);
      if (controller) {
        controller.destroy();
        if (window.__sky === controller) window.__sky = undefined;
      }
      if (previousTheme) root.setAttribute('data-theme', previousTheme);
    };
  }, [theme, tier, width, height, time, still, progress, pointerX, pointerY, rippleX, rippleY]);

  const frame: CSSProperties = {
    position: 'fixed',
    left: 0,
    top: 0,
    width: width ?? '100vw',
    height: height ?? '100vh',
    overflow: 'hidden',
  };
  return (
    <>
      <div className="ar-page" data-theme={theme} style={frame}>
        <div ref={box} style={{ position: 'absolute', inset: 0 }} />
      </div>
      {!still && progress === null ? <div aria-hidden="true" style={{ height: '300vh' }} /> : null}
    </>
  );
}
