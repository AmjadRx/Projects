/**
 * Opening a project from its card (motion sheet 7.3; DESIGN_DIRECTION.md 6.3; docs/V3_PLAN.md
 * D-47): the cover travels from the card to the project page's header in 250 ms (move) while the
 * rest of the page cross-fades (250 ms, fade), and the header's callouts draw once it has landed.
 * React's own ViewTransition arrives with the framework upgrade (React 19.3); until then this is
 * the browser's View Transitions API wrapped around the App Router's navigation.
 *
 * - Only the clicked card's cover and the header's cover carry the shared name `cover-<slug>`, and
 *   only for the length of the transition: a page never holds two elements with one name, and any
 *   other view transition (the theme's cross-fade) sees no named covers.
 * - The update callback pushes the route and settles once the project page has rendered its cover
 *   and the cover's picture has arrived, or after `page.cardToPage.wait`, whichever is first: the
 *   browser shows the old page, frozen, until it settles, so a slow network never holds a click
 *   for long.
 * - The browser's Back, from a project page opened this way to the very history entry it was opened
 *   from, runs it in reverse when the card is on screen there, and is a plain cross-fade otherwise;
 *   that page comes back at the scroll position it was left at. Any other traversal (Forward, a
 *   jump to another entry, a second visit to that entry) is the router's, untouched.
 * - Without the API, under reduced motion, while motion is paused, or for a click with a modifier,
 *   nothing here runs: the card is a plain link and Next navigates as it always does.
 *
 * Browser-only: the functions are called from event handlers and effects; the one listener below
 * is added when the module is first evaluated in a browser, which components/sheet/
 * CardTransitionListener.tsx makes happen on every public page during the first hydration.
 */
import { coverTransitionName, mostlyOnScreen } from './cardMotion';
import { cssEasing, page, toMs } from './motion';
import { motionPaused } from './motionPause';
import { motionOk } from './useMotionOk';

/** On a card's cover (components/sheet/ProjectCard.tsx): the project's slug. */
export const CARD_COVER_ATTR = 'data-cover-card';
/** On a project page's cover (components/sheet/CoverStage.tsx): the project's slug. */
export const PAGE_COVER_ATTR = 'data-cover-page';
/** On <html> while a card transition runs: app/motion-cards.css times the transition by it. */
const RUNNING_ATTR = 'data-card-vt';
/**
 * In the state of the history entry a card was opened from: that open's key. The router copies its
 * own fields into every entry it writes and keeps the others when it returns to an entry, so the
 * key stays with that entry, and only with it.
 */
export const FROM_KEY = '__arCardFrom';
/** What travels inside a cover wrapper: the photo's well, or a viewer's. */
const WELL = '.ar-well, .ar-mv__well';

interface RunningTransition {
  finished: Promise<void>;
  ready: Promise<void>;
  updateCallbackDone: Promise<void>;
}

type Start = (update: () => Promise<void>) => RunningTransition;

/** The transition in flight, and the promise that settles when it has finished. */
let running: { transition: RunningTransition; done: Promise<void> } | null = null;

/**
 * The last card opened: its key (also in the state of the history entry it was opened from), its
 * project, and the page's scroll position then. Used once, by the first return to that entry.
 */
let openedFrom: { key: string; slug: string; y: number } | null = null;

/** How many cards this page has opened, for each open's key. */
let opens = 0;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** document.startViewTransition, bound, where the browser has it. */
function starter(): Start | null {
  if (typeof document === 'undefined' || !('startViewTransition' in document)) return null;
  const start = (document as { startViewTransition?: unknown }).startViewTransition;
  return typeof start === 'function' ? (start.bind(document) as Start) : null;
}

/**
 * The card transition that is landing, if one is: the project page waits for it before it draws
 * its callouts on the cover (sheet 7.3: the callouts draw once the cover has landed). Null when
 * nothing is in flight.
 */
export function coverLanding(): Promise<void> | null {
  return running ? running.done : null;
}

/** The well inside a cover wrapper, or null while the wrapper holds none yet. */
function wellIn(wrapper: Element | null): HTMLElement | null {
  return wrapper?.querySelector<HTMLElement>(WELL) ?? null;
}

/** The well inside a cover wrapper, which is what travels; the wrapper itself when it holds none. */
function wellOf(wrapper: Element | null): HTMLElement | null {
  if (!wrapper) return null;
  return wellIn(wrapper) ?? (wrapper instanceof HTMLElement ? wrapper : null);
}

function bySlug(attr: string, slug: string): Element | null {
  return document.querySelector(`[${attr}="${CSS.escape(slug)}"]`);
}

/**
 * Resolves with what `find` returns once it is something, checking after each change to the page,
 * or with null at `deadline` (a performance.now() time).
 */
function waitFor<T>(find: () => T | null, deadline: number): Promise<T | null> {
  return new Promise((resolve) => {
    const first = find();
    if (first !== null) {
      resolve(first);
      return;
    }
    let timer = 0;
    const observer = new MutationObserver(() => {
      const found = find();
      if (found !== null) finish(found);
    });
    function finish(value: T | null) {
      observer.disconnect();
      window.clearTimeout(timer);
      resolve(value);
    }
    observer.observe(document.body, { childList: true, subtree: true });
    timer = window.setTimeout(() => finish(find()), Math.max(0, deadline - performance.now()));
  });
}

/**
 * The well a cover lands in, on the page the update is rendering: once the cover's wrapper holds
 * its well (a viewer may render a moment after the wrapper), or at `deadline` whatever is there,
 * the bare wrapper or nothing.
 */
async function landingWell(attr: string, slug: string, deadline: number): Promise<HTMLElement | null> {
  const well = await waitFor(() => wellIn(bySlug(attr, slug)), deadline);
  return well ?? wellOf(bySlug(attr, slug));
}

/**
 * Resolves once the picture in `well` has loaded (or failed), or at `deadline`.
 *
 * A lazy picture is made eager first. While a transition holds the page, the browser lays out
 * nothing new, so it starts no lazy load and a lazy picture would never arrive: every such click
 * (a video's poster in the project header, a card's photo further down the list on Back) would wait
 * out the whole cap and land on an empty well. The picture is in view either way: it is the cover
 * the transition lands on.
 */
function photoArrived(well: HTMLElement, deadline: number): Promise<void> {
  const img = well.querySelector('img');
  if (!img) return Promise.resolve();
  if (img.getAttribute('loading') === 'lazy') img.setAttribute('loading', 'eager');
  if (img.complete) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = window.setTimeout(done, Math.max(0, deadline - performance.now()));
    function done() {
      window.clearTimeout(timer);
      img?.removeEventListener('load', done);
      img?.removeEventListener('error', done);
      resolve();
    }
    img.addEventListener('load', done);
    img.addEventListener('error', done);
  });
}

/** Marks <html> for the transition's timing, from lib/motion.ts (app/motion-cards.css reads it). */
function markRunning(root: HTMLElement): void {
  root.setAttribute(RUNNING_ATTR, '');
  root.style.setProperty('--ar-vt-cover', `${toMs(page.cardToPage.cover.duration)}ms`);
  root.style.setProperty('--ar-vt-cover-ease', cssEasing(page.cardToPage.cover.ease));
  root.style.setProperty('--ar-vt-fade', `${toMs(page.cardToPage.crossFade.duration)}ms`);
  root.style.setProperty('--ar-vt-fade-ease', cssEasing(page.cardToPage.crossFade.ease));
}

function unmarkRunning(root: HTMLElement): void {
  root.removeAttribute(RUNNING_ATTR);
  for (const name of ['--ar-vt-cover', '--ar-vt-cover-ease', '--ar-vt-fade', '--ar-vt-fade-ease']) root.style.removeProperty(name);
}

/** Whether a card transition may start now: the API is there, nothing is in flight, motion is on. */
function mayStart(): Start | null {
  const start = starter();
  return start && !running && motionOk() && !motionPaused() ? start : null;
}

/**
 * Starts a card transition: names `from` (the cover on the page as it is), runs `update` (which
 * changes the page and names the cover on the new page, through `named`), and clears every name
 * when the transition has finished, or was skipped.
 */
function run(start: Start, from: HTMLElement | null, name: string, update: (named: (el: HTMLElement) => void) => Promise<void>): void {
  const root = document.documentElement;
  const touched: HTMLElement[] = [];
  const named = (el: HTMLElement) => {
    el.style.viewTransitionName = name;
    touched.push(el);
  };
  markRunning(root);
  if (from) named(from);
  const transition = start(async () => {
    // The browser has its picture of the old page: the old cover gives the name up first.
    if (from) from.style.viewTransitionName = '';
    await update(named);
  });
  const done = transition.finished
    .catch(() => undefined)
    .then(() => {
      for (const el of touched) el.style.viewTransitionName = '';
      unmarkRunning(root);
      if (running?.transition === transition) running = null;
    });
  // A skipped transition rejects these; the page has already changed, so nothing is lost.
  transition.ready.catch(() => undefined);
  transition.updateCallbackDone.catch(() => undefined);
  running = { transition, done };
}

/**
 * Marks the current history entry, the page a card is being opened from, with a new key, and
 * returns the key. The router's own fields are kept as they are, so it reads the entry as before.
 */
function markEntry(): string {
  opens += 1;
  const key = `${Date.now().toString(36)}.${opens}`;
  try {
    const state: unknown = window.history.state;
    window.history.replaceState({ ...(isRecord(state) ? state : {}), [FROM_KEY]: key }, '');
  } catch {
    // A browser that refuses (too many calls in a row) keeps the entry as it was: Back is the router's.
  }
  return key;
}

/**
 * Opens the project at `href` from its card with the transition, and returns true; or returns false
 * and does nothing when the transition may not run (the caller then lets the link navigate).
 * `card` is the card's element; `push` is the App Router's.
 */
export function openProject({ card, href, slug, push }: { card: Element; href: string; slug: string; push: (href: string) => void }): boolean {
  const start = mayStart();
  if (!start) return false;
  const from = wellOf(card.querySelector(`[${CARD_COVER_ATTR}]`));
  openedFrom = { key: markEntry(), slug, y: window.scrollY };
  run(start, from, coverTransitionName(slug), async (named) => {
    push(href);
    const deadline = performance.now() + toMs(page.cardToPage.wait);
    const to = await landingWell(PAGE_COVER_ATTR, slug, deadline);
    if (!to) return;
    await photoArrived(to, deadline);
    named(to);
  });
  return true;
}

/** Set while this module hands a held popstate event on to the router. */
let replaying = false;

/** Sets the scroll restoration of the current history entry and returns what it was, where the browser allows it. */
function restoreScroll(mode: ScrollRestoration): ScrollRestoration {
  try {
    const was = window.history.scrollRestoration;
    window.history.scrollRestoration = mode;
    return was;
  } catch {
    // Some embedded browsers refuse; the browser then restores as usual.
    return mode;
  }
}

/**
 * The browser's Back from a project page that a card opened, to the history entry the card was on.
 *
 * The router answers popstate as soon as it fires and renders the old page at once, before the
 * browser takes its picture of the project page. This listener is added when this module is first
 * evaluated, which is during the first hydration on every public page (CardTransitionListener),
 * before the router adds its own; browsers call a window's listeners in the order they were added
 * (Chrome 157 does so for a capture listener too, so registering first is the only way to run
 * first), so it runs first, holds the event back from the router, and hands the router the same
 * event once the picture is taken.
 *
 * Only the entry marked when the card was opened, by that open's key, and only the first return to
 * it: Forward to the same address, a jump to an entry of another visit, or a later Back after
 * Forward are the router's, with the browser's own scroll restoration. The browser restores the
 * scroll position right after popstate, which would land on the project page still showing; so the
 * traversal taken over restores nothing, and the page that comes back is put at the position it
 * was left at, which this module noted when the card was opened.
 */
function onPopState(event: PopStateEvent): void {
  if (replaying) return;
  const from = openedFrom;
  const state: unknown = event.state;
  // Only the router's own entries (the others it reloads or ignores), and only the marked one.
  if (!from || !isRecord(state) || !('__NA' in state) || state[FROM_KEY] !== from.key) return;
  openedFrom = null;
  const cover = wellOf(bySlug(PAGE_COVER_ATTR, from.slug));
  const start = cover ? mayStart() : null;
  if (!cover || !start) return;
  event.stopImmediatePropagation();
  const restoration = restoreScroll('manual');
  run(start, cover, coverTransitionName(from.slug), async (named) => {
    replaying = true;
    try {
      window.dispatchEvent(new PopStateEvent('popstate', { state }));
    } finally {
      replaying = false;
    }
    const deadline = performance.now() + toMs(page.cardToPage.wait);
    // The project page is gone once its cover is: the page that came back has rendered.
    const gone = await waitFor(() => (cover.isConnected ? null : true), deadline);
    window.scrollTo(0, from.y);
    restoreScroll(restoration);
    if (!gone) return;
    const to = wellOf(bySlug(CARD_COVER_ATTR, from.slug));
    if (!to || !mostlyOnScreen(to.getBoundingClientRect(), window.innerWidth, window.innerHeight)) return;
    await photoArrived(to, deadline);
    named(to);
  });
}

if (typeof window !== 'undefined') window.addEventListener('popstate', onPopState);
