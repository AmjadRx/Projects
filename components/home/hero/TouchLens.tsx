'use client';

import { useEffect, type RefObject } from 'react';
import { introPlaying } from '@/lib/intro';
import { hero } from '@/lib/motion';
import { createLens } from './lens';
import { clampToFrame, toDrawing } from './raven';
import { TouchLensMachine } from './touchMachine';

/**
 * The lens on phones and tablets (motion sheet 4.2; DESIGN_DIRECTION.md 6.1 and 7): after the
 * scan band, pressing and dragging on the drawing moves the lens (the rules are in ./touchMachine.ts).
 * The drawing keeps `touch-action: pan-y` and every listener is passive, so a vertical swipe
 * always scrolls the page; when the browser takes the gesture it sends pointercancel and the lens
 * fades. Nothing answers a press while the load sequence plays (the scan band's turn).
 */
export default function TouchLens({ art }: { art: RefObject<HTMLDivElement> }) {
  useEffect(() => {
    const root = art.current;
    if (!root) return;
    const section = root.closest('.hm-hero');
    const lens = createLens(root);
    const timers = new Set<number>();
    const machine = new TouchLensMachine({
      show: (point, jump) => {
        if (jump) lens.jumpTo(point);
        else lens.springTo(point, hero.touch.follow);
        lens.fade(1, hero.touch.fadeIn);
      },
      follow: (point) => lens.springTo(point, hero.touch.follow),
      hide: (seconds) => lens.fade(0, seconds),
      later: (ms, run) => {
        const id = window.setTimeout(() => {
          timers.delete(id);
          run();
        }, ms);
        timers.add(id);
        return () => {
          window.clearTimeout(id);
          timers.delete(id);
        };
      },
    });

    const at = (event: PointerEvent) => clampToFrame(toDrawing(event.clientX, event.clientY, root.getBoundingClientRect()));
    const onDown = (event: PointerEvent) => {
      if (introPlaying(section)) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      try {
        // Touch is captured anyway; a pen or a mouse must be, so its lift is never missed.
        root.setPointerCapture(event.pointerId);
      } catch {
        // Capture is a convenience: without it the lens still fades after the hold.
      }
      machine.down(event.pointerId, at(event));
    };
    const onMove = (event: PointerEvent) => machine.move(event.pointerId, at(event));
    const onUp = (event: PointerEvent) => machine.up(event.pointerId);
    const onCancel = (event: PointerEvent) => machine.cancel(event.pointerId);

    const options = { passive: true } as const;
    root.addEventListener('pointerdown', onDown, options);
    root.addEventListener('pointermove', onMove, options);
    root.addEventListener('pointerup', onUp, options);
    root.addEventListener('lostpointercapture', onUp, options);
    root.addEventListener('pointercancel', onCancel, options);
    return () => {
      root.removeEventListener('pointerdown', onDown);
      root.removeEventListener('pointermove', onMove);
      root.removeEventListener('pointerup', onUp);
      root.removeEventListener('lostpointercapture', onUp);
      root.removeEventListener('pointercancel', onCancel);
      machine.dispose();
      timers.forEach((id) => window.clearTimeout(id));
      lens.destroy();
    };
  }, [art]);

  return null;
}
