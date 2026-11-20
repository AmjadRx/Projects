'use client';

import { Ticker, useTicker } from 'motion-plus/react';
import { animate, cancelFrame, frame, useMotionValue } from 'motion/react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MutableRefObject } from 'react';
import { useDocumentVisible, useInView } from '@/components/viewers/shared/hooks';
import { page } from '@/lib/motion';
import {
  keyboardFocus,
  NO_HOLDS,
  tickerAdvance,
  tickerHeld,
  tickerHolds,
  tickerSpeed,
  tickerStep,
  type TickerInput,
} from './tickerMotion';

export interface MovingTickerProps {
  labels: string[];
  /** The id of the tools heading, which names the strip. */
  labelledBy: string;
}

type Step = (direction: 1 | -1) => void;

/**
 * The moving tools strip (motion sheet 7.7; DESIGN_DIRECTION.md 6.4), loaded on demand by
 * TickerStrip and mounted only while the strip is in view or just outside it: one Motion+ Ticker
 * that slides the list left one full copy every page.ticker.loop seconds, linear, and loops with no
 * seam. It starts where the still row stands, at the start of the list, so it can take the row's
 * place in view without a jump.
 * - It holds still while a mouse or pen is over it, while it has keyboard focus (the strip is a
 *   labelled region that takes focus), while it is pressed or dragged, out of view, or in a hidden
 *   tab, and asks for no frames of its own then (tickerHolds). Focus that a click or a tap gives it
 *   holds nothing: it moves on once the pointer has left.
 * - It can be dragged: Motion's drag moves the same offset, as the Motion+ draggable ticker does,
 *   and a release glides on with momentum; a vertical swipe still scrolls the page (pan-y).
 * - With focus, the arrow keys move it one item, with the snap spring.
 * - The list holds the same words in the same order as the still row. A copy the Ticker adds to
 *   fill a wide strip is hidden from assistive technology, so the list is read once.
 */
export default function MovingTicker({ labels, labelledBy }: MovingTickerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const step = useRef<Step | null>(null);
  const offset = useMotionValue(0);
  const [holds, setHolds] = useState(NO_HOLDS);
  const inView = useInView(ref);
  const visible = useDocumentVisible();
  const items = useMemo(
    () =>
      labels.map((label, i) => (
        <span key={`${label}-${i}`} className="hm-ticker__item">
          {label}
        </span>
      )),
    [labels],
  );

  // Native listeners: the Ticker draws the strip and sets its own pointer handlers on it.
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const report = (input: TickerInput) => setHolds((current) => tickerHolds(current, input));
    const enter = (event: PointerEvent) => report({ type: 'enter', pointer: event.pointerType });
    const leave = (event: PointerEvent) => report({ type: 'leave', pointer: event.pointerType });
    const press = () => {
      report({ type: 'press' });
      // The Ticker uncovers a copy that is pressed, for copies that hold links. These are words,
      // so every copy stays hidden from assistive technology.
      for (const copy of Array.from(el.querySelectorAll('.clone-item:not([aria-hidden="true"])'))) copy.setAttribute('aria-hidden', 'true');
    };
    const release = () => report({ type: 'release' });
    const focusIn = (event: FocusEvent) => report({ type: 'focus', keyboard: event.target instanceof Element && keyboardFocus(event.target) });
    const focusOut = (event: FocusEvent) => {
      if (!el.contains(event.relatedTarget as Node | null)) report({ type: 'blur' });
    };
    const key = () => report({ type: 'key' });
    el.addEventListener('pointerenter', enter);
    el.addEventListener('pointerleave', leave);
    el.addEventListener('pointerdown', press);
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    el.addEventListener('focusin', focusIn);
    el.addEventListener('focusout', focusOut);
    el.addEventListener('keydown', key);
    // Focus carried over from the still row (TickerStrip) is already inside.
    const active = document.activeElement;
    if (active && el.contains(active)) report({ type: 'focus', keyboard: keyboardFocus(active) });
    return () => {
      el.removeEventListener('pointerenter', enter);
      el.removeEventListener('pointerleave', leave);
      el.removeEventListener('pointerdown', press);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
      el.removeEventListener('focusin', focusIn);
      el.removeEventListener('focusout', focusOut);
      el.removeEventListener('keydown', key);
    };
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    step.current?.(event.key === 'ArrowRight' ? 1 : -1);
  };

  return (
    <Ticker
      ref={ref}
      items={items}
      offset={offset}
      drag="x"
      // A private but stable Motion API: the drag moves the ticker's own offset.
      _dragX={offset}
      gap={0}
      align="center"
      className="hm-ticker__view hm-ticker__view--moving"
      tabIndex={0}
      role="region"
      aria-labelledby={labelledBy}
      onKeyDown={onKeyDown}
    >
      <TickerDrive held={tickerHeld(holds, inView, visible)} step={step} />
    </Ticker>
  );
}

/**
 * The ticker's own motion, from inside it, where useTicker reads its measures: the slide, one
 * frame at a time while nothing holds it, and the arrow keys' step. A drag's momentum carries the
 * list on until it is slower than the slide, which then takes over, so a fling never ends in a
 * long crawl.
 */
function TickerDrive({ held, step }: { held: boolean; step: MutableRefObject<Step | null> }) {
  const { offset, totalItemLength, gap, itemPositions, isMeasured } = useTicker();
  const period = totalItemLength + gap;

  useEffect(() => {
    const speed = tickerSpeed(period, page.ticker.loop);
    if (held || !isMeasured || speed === 0) return undefined;
    const slide = ({ delta }: { delta: number }) => {
      if (offset.isAnimating()) {
        if (Math.abs(offset.getVelocity()) > speed) return;
        offset.stop();
      }
      offset.set(tickerAdvance(offset.get(), delta, speed));
    };
    frame.update(slide, true);
    return () => cancelFrame(slide);
  }, [held, isMeasured, period, offset]);

  useEffect(() => {
    const first = itemPositions[0]?.start ?? 0;
    const starts = itemPositions.map((position) => position.start - first);
    step.current = (direction) => {
      animate(offset, tickerStep(offset.get(), starts, period, direction), page.ticker.key);
    };
    return () => {
      step.current = null;
    };
  }, [itemPositions, period, offset, step]);

  return null;
}
