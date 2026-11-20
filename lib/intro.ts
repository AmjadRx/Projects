/**
 * The load sequence, once a visit (DESIGN_DIRECTION.md 6.2; motion sheet 2, 2.3 and 2.4; `load` in
 * lib/motion.ts): which page view plays it, and the marks its parts share.
 *
 * The marks, on the home page's hero section:
 * - `data-intro` (INTRO_ATTR) while the sequence plays in this page view. It is set before the
 *   headline and the drawing paint and holds every part's start state: the drawing's strokes
 *   undrawn and the desktop lens hidden, and the headline hidden until its line reveal takes over
 *   (app/motion-drawing.css; components/home/hero/Headline.tsx). Its value is the moment it was
 *   set, in milliseconds on the performance.now() clock: about the first paint, which the
 *   headline's give-up time (load.headline.giveUpAfter) counts from, through introAge().
 * - `data-intro-go` (INTRO_GO_ATTR) once the whole drawing is in the page. The drawing's steps
 *   (the stroke-in, the lens fade, the scan band) run from it in CSS, all from that one style pass,
 *   so a drawing that arrives in parts never draws in parts, and their times in `load` count from
 *   it.
 *
 * The end: both marks go once the drawing's steps have finished (the Web Animations API tells
 * when) and load.end has passed since data-intro was set; at once if motion is turned off during
 * the sequence (its steps stop); and at load.end where there is no drawing (media mode). The end
 * follows the animations themselves, not a timer alone, so a busy main thread that starts them
 * late never cuts the scan band short. After it, every part is in its final state.
 *
 * Who sets the marks:
 * - On a full page load, two inline scripts: introScript(), the hero section's first child, sets
 *   data-intro while the page is parsed, before the headline paints; introGoScript(), right after
 *   the drawing's svg, sets data-intro-go and waits for the end. Without scripts nothing is set
 *   and the page is simply final (sheet 2.4).
 * - After a client-side navigation to the home page, where React's copies of those scripts never
 *   run, beginIntro(), called from a layout effect before the new page first paints. The drawing
 *   is already whole there, so it sets both marks at once.
 *
 * Both play only when this visit has not seen the sequence, the visitor does not prefer reduced
 * motion, has not paused motion and has not turned on Save-Data (sheet 8.2: nothing plays by
 * itself). Both mark the visit as seen at once: the sessionStorage key `load.onceKey`, and
 * data-intro-seen on <html> (INTRO_SEEN_ATTR), which needs no storage and outlives data-intro, so
 * a visit whose storage is blocked never plays the sequence twice in one page. Back on the home
 * page in the same visit, everything paints final.
 *
 * No React and no Next imports: the server's Hero renders the scripts, the browser calls the rest.
 */
import { load, toMs } from './motion';

/** The attribute on the hero section while the load sequence plays in this page view. */
export const INTRO_ATTR = 'data-intro';

/** The attribute on the hero section once the whole drawing is in the page: its steps run. */
export const INTRO_GO_ATTR = 'data-intro-go';

/** The attribute on <html> once this page has played the sequence (or started to). */
export const INTRO_SEEN_ATTR = 'data-intro-seen';

/** The hero section, and the drawing whose animations the end waits for (RavenDrawing). */
const HERO = '.hm-hero';
const DRAWING = '.hd-svg';

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

/** Set on <html> by the head script (lib/theme.ts) and by lib/motionPause.ts while motion is paused. */
const PAUSED_ATTR = 'data-motion-paused';

/** The timed part ends by load.end (1,600 ms): the earliest the marks go. */
const END_MS = toMs(load.end);

/** What decides whether the sequence plays. */
export type IntroConditions = {
  /** This visit has already played it. */
  seen: boolean;
  reducedMotion: boolean;
  /** The visitor's pause-motion choice (D-67). */
  paused: boolean;
  /** The browser's data saver (navigator.connection.saveData): nothing plays by itself (sheet 8.2). */
  saveData: boolean;
};

/** Once a visit, never under reduced motion, with motion paused, or with Save-Data on. */
export function introWanted({ seen, reducedMotion, paused, saveData }: IntroConditions): boolean {
  return !seen && !reducedMotion && !paused && !saveData;
}

/** True once this visit has played the sequence. Browser only. */
export function introSeen(): boolean {
  if (document.documentElement.hasAttribute(INTRO_SEEN_ATTR)) return true;
  try {
    return window.sessionStorage.getItem(load.onceKey) !== null;
  } catch {
    return false;
  }
}

/** Records that this visit has played the sequence. Browser only. */
export function markIntroSeen(): void {
  document.documentElement.setAttribute(INTRO_SEEN_ATTR, '');
  try {
    window.sessionStorage.setItem(load.onceKey, '1');
  } catch {
    // Storage is blocked: the attribute on <html> still remembers, for this page.
  }
}

function saveDataOn(): boolean {
  try {
    return (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;
  } catch {
    return false;
  }
}

/** This browser's answers to IntroConditions, read now. */
function browserConditions(): IntroConditions {
  let reducedMotion = false;
  try {
    reducedMotion = window.matchMedia(REDUCED_MOTION).matches;
  } catch {
    // No matchMedia: nothing says to reduce motion.
  }
  return {
    seen: introSeen(),
    reducedMotion,
    paused: document.documentElement.hasAttribute(PAUSED_ATTR),
    saveData: saveDataOn(),
  };
}

/**
 * The inline script for the hero section, the same rules as beginIntro() for a full page load: it
 * sets data-intro and marks the visit. It reads its own parent through document.currentScript, so
 * it must be that section's first child. Without a drawing (media mode) it ends the sequence at
 * load.end; with one, introGoScript() takes the end over. Written without doubled braces, which
 * the content check reads as template placeholders.
 */
export function introScript(): string {
  const key = JSON.stringify(load.onceKey);
  const attr = JSON.stringify(INTRO_ATTR);
  return (
    `(function () { var s = document.currentScript, h = s && s.parentNode, d = document.documentElement; if (!h) return; ` +
    `try { if (sessionStorage.getItem(${key}) !== null) return; } catch (e) { } ` +
    `try { if (matchMedia(${JSON.stringify(REDUCED_MOTION)}).matches) return; } catch (e) { } ` +
    `if (d.hasAttribute(${JSON.stringify(PAUSED_ATTR)})) return; ` +
    `try { var c = navigator.connection; if (c && c.saveData) return; } catch (e) { } ` +
    `h.setAttribute(${attr}, String(Math.round(performance.now()))); d.setAttribute(${JSON.stringify(INTRO_SEEN_ATTR)}, ''); ` +
    `try { sessionStorage.setItem(${key}, '1'); } catch (e) { } ` +
    `setTimeout(function () { if (!h.hasAttribute(${JSON.stringify(INTRO_GO_ATTR)})) h.removeAttribute(${attr}); }, ${END_MS}); })();`
  );
}

/**
 * The inline script right after the drawing's svg (HeroDrawing): by the time it runs, the whole
 * drawing has been parsed. While the sequence plays it sets data-intro-go, so every step of the
 * drawing starts in the same style pass, then takes both marks off at the end (the file comment):
 * once every animation in the drawing has finished or stopped, and not before load.end since
 * data-intro. Where the browser cannot list animations, it ends load.end after the go.
 */
export function introGoScript(): string {
  const attr = JSON.stringify(INTRO_ATTR);
  const go = JSON.stringify(INTRO_GO_ATTR);
  return (
    `(function () { var s = document.currentScript, h = s && s.closest ? s.closest(${JSON.stringify(HERO)}) : null; ` +
    `if (!h || !h.hasAttribute(${attr})) return; ` +
    `var t = Number(h.getAttribute(${attr})), v = s.parentNode.querySelector(${JSON.stringify(DRAWING)}), a = null, x = false; ` +
    `var end = function () { h.removeAttribute(${attr}); h.removeAttribute(${go}); }; ` +
    `h.setAttribute(${go}, ''); ` +
    `try { a = v.getAnimations({ subtree: true }); } catch (e) { } ` +
    `if (!a) { setTimeout(end, ${END_MS}); return; } ` +
    `Promise.all(a.map(function (n) { return n.finished.catch(function () { x = true; }); })).then(function () { ` +
    `setTimeout(end, x ? 0 : Math.max(0, t + ${END_MS} - performance.now())); }); })();`
  );
}

/** Takes both marks off: the sequence has ended, and every part is in its final state. */
function endIntro(section: Element): void {
  section.removeAttribute(INTRO_ATTR);
  section.removeAttribute(INTRO_GO_ATTR);
}

/** introGoScript()'s rules, for a sequence beginIntro() started at `start`. */
function runIntro(section: HTMLElement, start: number): void {
  const end = () => endIntro(section);
  const drawing = section.querySelector(DRAWING);
  if (!drawing) {
    window.setTimeout(end, END_MS);
    return;
  }
  section.setAttribute(INTRO_GO_ATTR, '');
  let running: Animation[] | null = null;
  try {
    // Reading them applies the go mark's styles at once, so every step starts in this frame.
    running = drawing.getAnimations({ subtree: true });
  } catch {
    running = null;
  }
  if (!running) {
    window.setTimeout(end, END_MS);
    return;
  }
  let stopped = false;
  void Promise.all(
    running.map((animation) =>
      animation.finished.catch(() => {
        stopped = true;
      }),
    ),
  ).then(() => {
    window.setTimeout(end, stopped ? 0 : Math.max(0, start + END_MS - performance.now()));
  });
}

/**
 * Starts the sequence on a hero section the inline scripts never saw (a client-side navigation),
 * when this visit wants it. Returns true while the sequence plays on `section`, whoever started it.
 * Call it from a layout effect, so the start state is in place before the section first paints.
 */
export function beginIntro(section: HTMLElement): boolean {
  if (section.hasAttribute(INTRO_ATTR)) {
    // Inline scripts started it. Note the visit; a late drawing gets its go.
    markIntroSeen();
    if (!section.hasAttribute(INTRO_GO_ATTR) && section.querySelector(DRAWING)) {
      runIntro(section, Number(section.getAttribute(INTRO_ATTR)));
    }
    return true;
  }
  if (!introWanted(browserConditions())) return false;
  const start = Math.round(performance.now());
  section.setAttribute(INTRO_ATTR, String(start));
  markIntroSeen();
  runIntro(section, start);
  return true;
}

/** True while the load sequence plays on this section. */
export function introPlaying(section: Element | null | undefined): boolean {
  return Boolean(section?.hasAttribute(INTRO_ATTR));
}

/**
 * The longest afterIntro() waits, counted from data-intro (about the first paint): twice load.end.
 * The end normally comes well before it; the cap is for a hero that leaves the page before its end
 * (a client-side navigation away), where no end ever comes.
 */
const DEFER_CAP_MS = END_MS * 2;

/**
 * Runs `run` once the load sequence has ended in this page view, or at once when none plays. Work
 * the visitor cannot see yet (the sky's live scene, Motion's features for the cards, the readouts'
 * AnimateNumber for a row below the fold) waits for it, so its scripts never land on the
 * sequence's frames on a slow phone. It waits at most DEFER_CAP_MS after data-intro was set.
 * Returns the function that cancels the wait.
 */
export function afterIntro(run: () => void, doc: Document | undefined = typeof document === 'undefined' ? undefined : document): () => void {
  const section = doc && typeof doc.querySelector === 'function' ? doc.querySelector(HERO) : null;
  if (!section || !introPlaying(section) || typeof MutationObserver !== 'function') {
    run();
    return () => {};
  }
  let waiting = true;
  const stop = () => {
    waiting = false;
    observer.disconnect();
    clearTimeout(timer);
  };
  const finish = () => {
    if (!waiting) return;
    stop();
    run();
  };
  const observer = new MutationObserver(() => {
    if (!introPlaying(section)) finish();
  });
  observer.observe(section, { attributes: true, attributeFilter: [INTRO_ATTR] });
  const timer = setTimeout(finish, Math.max(0, DEFER_CAP_MS - (introAge(section) ?? 0)));
  return () => {
    if (waiting) stop();
  };
}

/**
 * Milliseconds since data-intro was set on this section (about its first paint), or null when the
 * sequence is not playing. A part that starts late (a slow script) compares this with its own
 * time and skips to its final state once that has passed, as the headline does after
 * load.headline.giveUpAfter. The drawing's steps count from data-intro-go instead, in CSS.
 */
export function introAge(section: Element | null | undefined): number | null {
  const value = section?.getAttribute(INTRO_ATTR);
  if (value === null || value === undefined) return null;
  const start = Number(value);
  return Number.isFinite(start) ? Math.max(0, performance.now() - start) : 0;
}
