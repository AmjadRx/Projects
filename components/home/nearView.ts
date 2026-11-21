'use client';

import { useEffect, useLayoutEffect, useState, type RefObject } from 'react';

/** A layout effect in the browser; React warns about one in the server render, which runs neither. */
export const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** The page frame (.ar-frame), whose width the design's container queries read. */
function frameOf(el: Element | null): HTMLElement | null {
  return el?.closest<HTMLElement>('.ar-frame') ?? null;
}

/**
 * The width of the page frame around `ref`, in CSS px, measured on the frame itself so it agrees
 * with the container queries (as components/site/MobileMenu.tsx measures it), and kept current.
 * Null on the server and until the first measure, so the first client render matches the server's.
 */
export function useFrameWidth(ref: RefObject<Element>): number | null {
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    const frame = frameOf(ref.current);
    const read = () => setWidth(frame ? frame.getBoundingClientRect().width : window.innerWidth);
    read();
    if (!frame || typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', read);
      return () => window.removeEventListener('resize', read);
    }
    const observer = new ResizeObserver(read);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

/** An observer's margin above and below the window, in window heights. */
export function windowsMargin(windows: number): string {
  return `${Math.round(windows * 100)}% 0px`;
}

/** The latest report of an observer that watches one element. */
function latest(entries: IntersectionObserverEntry[]): IntersectionObserverEntry | undefined {
  return entries[entries.length - 1];
}

/**
 * True once `ref` comes within `near` window heights of the view, false again once it is more
 * than `far` away: two observers, so a piece resting at the edge of one margin never flickers
 * between the two (one observer when `far` is not beyond `near`). False on the server, until the
 * first observation, and while not `enabled`.
 */
export function useNearView(ref: RefObject<Element>, near: number, far: number, enabled: boolean): boolean {
  const [isNear, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el || typeof IntersectionObserver === 'undefined') {
      setNear(false);
      return undefined;
    }
    const banded = far > near;
    const observers = [
      new IntersectionObserver(
        (entries) => {
          const entry = latest(entries);
          if (entry?.isIntersecting) setNear(true);
          else if (entry && !banded) setNear(false);
        },
        { rootMargin: windowsMargin(near) },
      ),
    ];
    if (banded) {
      observers.push(
        new IntersectionObserver(
          (entries) => {
            const entry = latest(entries);
            if (entry && !entry.isIntersecting) setNear(false);
          },
          { rootMargin: windowsMargin(far) },
        ),
      );
    }
    for (const observer of observers) observer.observe(el);
    return () => {
      for (const observer of observers) observer.disconnect();
    };
  }, [ref, near, far, enabled]);
  return isNear;
}

/**
 * Whether any part of `ref` is in the window: null until the first observation and while not
 * `enabled`, so a piece that must never change in view waits until this says false.
 */
export function useOnScreen(ref: RefObject<Element>, enabled: boolean): boolean | null {
  const [onScreen, setOnScreen] = useState<boolean | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el || typeof IntersectionObserver === 'undefined') {
      setOnScreen(null);
      return undefined;
    }
    const observer = new IntersectionObserver((entries) => {
      const entry = latest(entries);
      if (entry) setOnScreen(entry.isIntersecting);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, enabled]);
  return onScreen;
}

/** Whether any part of `el` is in the window now, read from the layout (the observers report late). */
export function inWindow(el: Element): boolean {
  const view = el.ownerDocument.defaultView;
  if (!view) return false;
  const box = el.getBoundingClientRect();
  return box.bottom > 0 && box.top < view.innerHeight && box.right > 0 && box.left < view.innerWidth;
}
