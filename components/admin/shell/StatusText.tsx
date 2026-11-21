'use client';

/**
 * The save bar's status line ("Unsaved changes in 2 files", "Saving", "Saved as commit abc1234").
 *
 * Motion (DESIGN_DIRECTION.md 6.4; motion sheet 8.3): the admin's one motion. When the words
 * change, the line scrambles into the new ones through Motion+ ScrambleText (its `scrambleText`
 * engine) and settles left to right within 400 ms (`admin.status` in lib/motion.ts). The words a
 * line mounts with show as they are, and under reduced motion every change shows at once; the
 * setting is read live. useMotionOk() is false on all of /admin by design, so this line reads the
 * reduced-motion setting itself: it is the one exception the sheets make.
 *
 * Why the engine and not the React `<ScrambleText>`: that component draws a full `motion.span`,
 * which would bring all of Motion's component code (animation, gestures, drag, layout: about 42 kB
 * brotli) to /admin for one line of text, and ARCHITECTURE.md 8 allows no animation library there
 * beyond what the save bar needs. The engine is the same scramble, under 1 kB, with no dependency,
 * and it evaluates no strings (the admin's policy forbids that).
 *
 * Screen readers hear the final words once: the live region is a visually hidden copy that only
 * ever holds them. What is drawn is hidden from assistive technology: the words, which keep the
 * line's layout (unpainted while the scramble runs, so nothing moves or re-breaks), and the
 * scramble, drawn over them from the same place on one line (StatusText.module.css). Lines never
 * re-break in motion (sheet 8.3), so the scramble draws its characters from the new words' own,
 * which keeps it about as wide as they are, and words that wrap (a long error) are set at once.
 */
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { CircleAlert, CircleCheck, CircleDot, LoaderCircle } from 'lucide-react';
import { scrambleText } from 'motion-plus';
import { admin } from '@/lib/motion';
import { subscribeMotionOk } from '@/lib/useMotionOk';
import { cx } from '../ui/cx';
import styles from './StatusText.module.css';

export type StatusTone = 'idle' | 'dirty' | 'busy' | 'ok' | 'error';

const ICONS: Record<StatusTone, ReactNode> = {
  idle: null,
  dirty: <CircleDot size={16} />,
  busy: <LoaderCircle size={16} className="adm-spin" />,
  ok: <CircleCheck size={16} />,
  error: <CircleAlert size={16} />,
};

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

/** Whether the visitor asks for reduced motion, now. */
function reducedNow(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(REDUCED_MOTION).matches;
}

/** The server render, and hydration, change no words: nothing to scramble there. */
function reducedOnServer(): boolean {
  return true;
}

/**
 * When character `index` of a line `length` long stops scrambling, in seconds: the first after
 * `settleFirst`, the last after `settleLast`, the rest evenly between, so any line reads whole in
 * the same time. A ScrambleText stagger (its `duration` option). Pure, for tests.
 */
export function settleAfter(index: number, length: number): number {
  const { settleFirst, settleLast } = admin.status;
  return length > 1 ? settleFirst + ((settleLast - settleFirst) * index) / (length - 1) : settleFirst;
}

/**
 * What a line scrambles through: the characters of its own words, as often as they occur there,
 * so a scrambled line stays about as wide as its words. Spaces stay put. Pure, for tests.
 */
export function scrambleCharsOf(text: string): string[] {
  return Array.from(text.replace(/\s/g, ''));
}

/** The scramble starts before the first paint of the new words; the server has nothing to start. */
const useBeforePaint = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** A status line, read out politely by screen readers when it changes, that scrambles into its new words. */
export function StatusText({ text, tone = 'idle', className }: { text: string; tone?: StatusTone; className?: string }) {
  const still = useSyncExternalStore(subscribeMotionOk, reducedNow, reducedOnServer);
  /** The words the line last settled on. It scrambles while `text` differs from them. */
  const [settled, setSettled] = useState(text);
  if (still && settled !== text) setSettled(text);
  const scrambling = !still && settled !== text;
  const scrambleRef = useRef<HTMLSpanElement>(null);
  const wordsRef = useRef<HTMLSpanElement>(null);

  useBeforePaint(() => {
    const element = scrambleRef.current;
    if (!scrambling || !element) return undefined;
    const chars = scrambleCharsOf(text);
    // Words on more than one line are set at once (a scramble would re-break them), as are words with nothing to scramble.
    if (chars.length === 0 || (wordsRef.current?.getClientRects().length ?? 0) > 1) {
      setSettled(text);
      return undefined;
    }
    // The engine scrambles what the element holds, and writes there only: React gives it no children.
    element.textContent = text;
    let current = true;
    const controls = scrambleText(element, {
      chars,
      duration: settleAfter,
      interval: admin.status.interval,
      onComplete: () => {
        if (current) setSettled(text);
      },
    });
    return () => {
      current = false;
      controls.stop();
    };
  }, [scrambling, text]);

  return (
    <p className={cx('adm-status', `adm-status--${tone}`, className)}>
      {ICONS[tone] ? (
        <span className="adm-status__icon" aria-hidden="true">
          {ICONS[tone]}
        </span>
      ) : null}
      <span className={cx('adm-status__text', styles.text)}>
        <span className="adm-sr" aria-live="polite" aria-atomic="true">
          {text}
        </span>
        <span ref={wordsRef} className={styles.words} data-scrambling={scrambling ? '' : undefined} aria-hidden="true">
          {text}
        </span>
        {scrambling ? <span ref={scrambleRef} className={styles.scramble} aria-hidden="true" /> : null}
      </span>
    </p>
  );
}
