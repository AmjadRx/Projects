'use client';

import { useCallback, useEffect, useReducer, type RefObject } from 'react';
import { hero, media, toMs } from '@/lib/motion';
import { prefersTapToLoad } from '../shared/useViewerActivation';

/**
 * When the hero's model loads its engine (ARCHITECTURE.md 6: "the viewer loads after the page is
 * interactive"; motion sheets 4.5 and 6.3). The poster always paints first.
 *
 * - Desktop with a fine pointer: after the load event, in the browser's next idle period (or a
 *   moment after the load event where there is no requestIdleCallback), once the stage is within
 *   200 px of the view. A visitor who scrolled away first gets it when the hero comes back.
 * - Phones and tablets, and any slow or metered connection: on a tap of the poster's button.
 *
 * `byTap` says the engine was loaded by that tap: the hero then turns slowly until first touched
 * (sheet 4.5, "the poster, then a slow turn after a tap").
 *
 * The decisions are plain functions (heroLoadPlan, heroActivation) so the tests can read them; the
 * hook only wires them to the browser.
 */
export interface HeroActivation {
  active: boolean;
  requiresTap: boolean;
  byTap: boolean;
  activate: () => void;
}

/** How the engine waits to load, decided once when the hero mounts. */
export type HeroLoadPlan =
  /** Phones, tablets, and slow or metered connections: the poster's button loads it. */
  | { wait: 'tap' }
  | {
      /** Desktop: after the page is interactive and once the stage is near the view. */
      wait: 'interactive';
      /** The page is still loading: wait for the window's load event first. */
      afterLoadEvent: boolean;
      /** Then the browser's next idle period (at most `timeout` ms away), or `ms` ms without requestIdleCallback. */
      idle: { kind: 'callback'; timeout: number } | { kind: 'delay'; ms: number };
      /** Then the stage within 200 px of the view (sheet 6.3), as an IntersectionObserver margin. */
      rootMargin: string;
    };

export function heroLoadPlan({
  tapPreferred,
  readyState,
  hasIdleCallback,
}: {
  /** prefersTapToLoad('view-or-tap'): no fine pointer, or a slow or metered connection. */
  tapPreferred: boolean;
  readyState: DocumentReadyState;
  hasIdleCallback: boolean;
}): HeroLoadPlan {
  if (tapPreferred) return { wait: 'tap' };
  const { idleTimeout, noIdleDelay } = hero.model.afterInteractive;
  return {
    wait: 'interactive',
    afterLoadEvent: readyState !== 'complete',
    idle: hasIdleCallback ? { kind: 'callback', timeout: toMs(idleTimeout) } : { kind: 'delay', ms: toMs(noIdleDelay) },
    rootMargin: `${media.model.loadMargin}px 0px`,
  };
}

export interface HeroActivationState {
  active: boolean;
  requiresTap: boolean;
  byTap: boolean;
}

/**
 * - `tap-needed`: the plan waits for a tap, so the poster shows its button.
 * - `near`: desktop, the page interactive and the stage near the view.
 * - `activate`: the poster's button, or a view button pressed before the engine loaded.
 */
export type HeroActivationEvent = 'tap-needed' | 'near' | 'activate';

/** Before anything is decided, on the server too: inactive, so the poster paints first. */
export const HERO_INACTIVE: HeroActivationState = { active: false, requiresTap: false, byTap: false };

/**
 * The activation's state machine. The engine starts on `near` or `activate` and then stays on; it
 * was started by a tap when the poster's button was showing.
 */
export function heroActivation(state: HeroActivationState, event: HeroActivationEvent): HeroActivationState {
  if (state.active) return state;
  switch (event) {
    case 'tap-needed':
      return state.requiresTap ? state : { ...state, requiresTap: true };
    case 'near':
      return { active: true, requiresTap: false, byTap: false };
    case 'activate':
      return { active: true, requiresTap: false, byTap: state.requiresTap };
    default:
      return state;
  }
}

export function useHeroActivation(ref: RefObject<Element>): HeroActivation {
  const [state, dispatch] = useReducer(heroActivation, HERO_INACTIVE);
  const { active } = state;

  useEffect(() => {
    if (active) return undefined;
    const plan = heroLoadPlan({
      tapPreferred: prefersTapToLoad('view-or-tap'),
      readyState: document.readyState,
      hasIdleCallback: typeof window.requestIdleCallback === 'function',
    });
    if (plan.wait === 'tap') {
      dispatch('tap-needed');
      return undefined;
    }
    const { afterLoadEvent, idle: wait, rootMargin } = plan;
    let observer: IntersectionObserver | null = null;
    let idle = 0;
    let timer = 0;
    const whenNear = () => {
      const element = ref.current;
      if (!element || !('IntersectionObserver' in window)) {
        dispatch('near');
        return;
      }
      observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            observer?.disconnect();
            dispatch('near');
          }
        },
        { rootMargin },
      );
      observer.observe(element);
    };
    const afterLoad = () => {
      if (wait.kind === 'callback') idle = window.requestIdleCallback(whenNear, { timeout: wait.timeout });
      else timer = window.setTimeout(whenNear, wait.ms);
    };
    if (afterLoadEvent) window.addEventListener('load', afterLoad, { once: true });
    else afterLoad();
    return () => {
      window.removeEventListener('load', afterLoad);
      if (idle && typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(idle);
      if (timer) window.clearTimeout(timer);
      observer?.disconnect();
    };
  }, [active, ref]);

  const activate = useCallback(() => dispatch('activate'), []);
  return { ...state, activate };
}
