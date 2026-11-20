/**
 * The sky's host at run time (Phase 5): everything components/sky/Sky.tsx does once the page is in
 * the browser, as one function that returns its own teardown. No three.js and no React here; the
 * live scene (components/sky/live, see ./contract.ts) is imported only when it is wanted.
 *
 * - The tier (lib/sky/tier.ts) is chosen from the device and the visitor's settings and written as
 *   <html data-sky-tier> (full, light or still) for the stylesheet. Reduced motion, Save-Data and
 *   the pause control send the sky to Still at once (destroying the scene) and bring it back when
 *   they clear. The frame rate steps it down (Full to Light, then Light to Still with a fade) and a
 *   failure sends it to Still; neither is undone during the visit.
 * - The scene's chunk is imported never before the load event and the end of the home page's load
 *   sequence, then at the next idle moment (SKY.liveLoad), and only for a tier other than Still.
 *   The scene is asked whether it can draw
 *   (canRender) before any of its data is fetched. It starts from the still image's step
 *   (<html data-sky-step>, written by the head script in lib/theme.ts), so the fade shows no jump.
 * - The live layer fades in (.is-ready, 600 ms in CSS) once the first frame is drawn, never before
 *   SKY.liveFade.notBefore after the first paint.
 * - Input comes from passive window listeners: the pointer anywhere for the parallax, marked when it
 *   is not over empty sky (./emptySky.ts) so the scene draws no drafting lines there; a click on
 *   empty sky (a tap on touch screens); a touch drag that starts on empty sky (page scrolling
 *   always wins: nothing calls preventDefault); scroll and wheel. The frame loop stops while the tab
 *   is hidden and after SKY.idlePause seconds without input; input starts it again.
 * - <html data-theme> changes reach the scene through a MutationObserver, and the layer's size
 *   through a ResizeObserver.
 */
import { afterIntro } from '@/lib/intro';
import { SKY, toMs } from '@/lib/motion';
import { motionPaused, subscribeMotionPaused } from '@/lib/motionPause';
import { STILL_FALLBACK_STEP, stepTimeNear } from '@/lib/sky/still-steps';
import {
  chooseTier,
  connectionOf,
  createFpsGovernor,
  lowerTier,
  readDeviceHints,
  saveDataOn,
  stepDown,
  type FpsGovernor,
  type LiveTier,
  type SkyTier,
} from '@/lib/sky/tier';
import { currentTheme, parseSkyStep } from '@/lib/theme';
import { motionOk, subscribeMotionOk } from '@/lib/useMotionOk';
import type { LiveController, LiveModule, LiveOptions } from './contract';
import { isEmptySky } from './emptySky';

/** Makes a scene in a container, with the data already loaded for its tier. */
export type MakeScene = (container: HTMLElement, options: LiveOptions) => LiveController;

/** Loads the data for a tier and gives back the function that makes the scene with it. */
export type SceneFactory = (tier: LiveTier) => Promise<MakeScene>;

/**
 * The live module bound to its own data type, so the host never needs to name that type. It asks
 * the scene whether it can draw before any data is fetched: without usable WebGL (a blocked GPU,
 * or only a software renderer) it rejects, the host goes to Still, and none of the sky's data is
 * downloaded.
 */
export function bindLive<Data>(live: LiveModule<Data>): SceneFactory {
  return async (tier) => {
    if (!live.canRender()) throw new Error('webgl');
    const data = await live.loadSkyData(tier, currentTheme());
    return (container, options) => live.createSky(container, data, options);
  };
}

async function importLive(): Promise<SceneFactory> {
  return bindLive(await import('./live'));
}

export interface SkyHostElements {
  /** .ar-sky: the fixed layer the size of the viewport. */
  root: HTMLElement;
  /** .ar-sky__live: the scene draws its canvases here; .is-ready fades it in. */
  live: HTMLElement;
  /** .ar-sky__labels, above the dawn: the scene's drafting lines and star name (the live layer when absent). */
  labels?: HTMLElement;
}

export interface SkyHostOptions {
  /** Scroll progress from 0 to 1, read by the scene every frame (Motion's scrollYProgress). */
  getProgress: () => number;
  /** Imports the live scene. Tests pass their own. */
  loadLive?: () => Promise<SceneFactory>;
}

/** A scene the host made, with what the host knows about it. */
interface Scene {
  controller: LiveController | null;
  tier: LiveTier;
  ready: boolean;
  governor: FpsGovernor | null;
}

type Timer = ReturnType<typeof setTimeout>;

/**
 * Runs `run` after the load event, at the browser's next idle moment (SKY.liveLoad). Returns the
 * function that cancels it.
 */
function afterLoadAndIdle(win: Window, doc: Document, run: () => void): () => void {
  let idleId: number | undefined;
  let timer: Timer | undefined;
  const idle = () => {
    if (typeof win.requestIdleCallback === 'function') {
      idleId = win.requestIdleCallback(run, { timeout: toMs(SKY.liveLoad.idleTimeout) });
    } else {
      timer = setTimeout(run, toMs(SKY.liveLoad.noIdleDelay));
    }
  };
  if (doc.readyState === 'complete') idle();
  else win.addEventListener('load', idle, { once: true });
  return () => {
    win.removeEventListener('load', idle);
    if (idleId !== undefined && typeof win.cancelIdleCallback === 'function') win.cancelIdleCallback(idleId);
    if (timer !== undefined) clearTimeout(timer);
  };
}

/** The first paint, in performance.now() time; 0 (the start of the page) where it is not reported. */
function firstPaintMs(win: Window): number {
  const perf = win.performance;
  if (!perf || typeof perf.getEntriesByName !== 'function') return 0;
  const entry = perf.getEntriesByName('first-paint')[0] ?? perf.getEntriesByName('first-contentful-paint')[0];
  return entry ? entry.startTime : 0;
}

/** The touch with this identifier in a list, if it is there. */
function touchIn(list: TouchList, id: number): Touch | null {
  for (let i = 0; i < list.length; i += 1) {
    const touch = list[i];
    if (touch && touch.identifier === id) return touch;
  }
  return null;
}

/** Starts the host on the sky's layers. Returns the teardown, which leaves nothing running. */
export function startSkyHost(elements: SkyHostElements, options: SkyHostOptions): () => void {
  const win = window;
  const doc = document;
  const html = doc.documentElement;
  const loadLive = options.loadLive ?? importLive;
  const device = readDeviceHints(win);
  const idleMs = toMs(SKY.idlePause);
  const listen = { passive: true } as const;

  /** The lowest tier allowed for the rest of the visit: lowered by the frame rate and by failures. */
  let floor: SkyTier = 'full';
  let disposed = false;
  let factory: SceneFactory | null = null;
  /** The scene on screen (or being made), or null. */
  let scene: Scene | null = null;
  /** The attempt to make a scene that is under way (0: none). */
  let attempt = 0;
  let attempts = 0;
  let cancelWait: (() => void) | null = null;
  /** True while the scene's frame loop runs. */
  let running = false;
  let lastInput = performance.now();
  let idleTimer: Timer | undefined;
  const timers = new Set<Timer>();
  /** Scenes fading out after a step down to Still, destroyed when the fade ends. */
  const leaving = new Set<LiveController>();
  /** A touch that started on empty sky: the drag moves the parallax. */
  let dragId: number | null = null;
  /** The mouse or pen's last point, for marking it off empty sky while the page scrolls under it. */
  let hover: { x: number; y: number } | null = null;
  /** A touch that went down on empty sky: if it lifts without the browser taking it, a ripple. */
  let tap: { id: number; x: number; y: number } | null = null;

  function later(run: () => void, ms: number): void {
    const timer = setTimeout(() => {
      timers.delete(timer);
      run();
    }, ms);
    timers.add(timer);
  }

  /** The tier the sky should be at now. */
  function wanted(): SkyTier {
    const tier = chooseTier({ ...device, reducedMotion: !motionOk(), saveData: saveDataOn(win), paused: motionPaused() });
    return lowerTier(tier, floor);
  }

  /** Brings the sky to the tier it should be at. `fade`: a step down to Still fades the scene out. */
  function update(fade = false): void {
    if (disposed) return;
    const tier = wanted();
    html.setAttribute('data-sky-tier', tier);
    if (tier === 'still') {
      settle(fade);
      return;
    }
    if (scene) {
      if (scene.controller && scene.tier !== tier) {
        scene.tier = tier;
        scene.controller.setTier(tier);
        scene.governor?.reset(performance.now());
      }
      return;
    }
    if (!attempt) {
      attempts += 1;
      const id = attempts;
      attempt = id;
      // On the first home view the scene also waits for the load sequence to end (lib/intro.ts),
      // so its boot never lands on the sequence's frames on a slow phone; the still shows until.
      let cancelIdle: (() => void) | null = null;
      const cancelIntro = afterIntro(() => {
        cancelIdle = afterLoadAndIdle(win, doc, () => {
          cancelWait = null;
          void make(id);
        });
      }, doc);
      cancelWait = () => {
        cancelIntro();
        cancelIdle?.();
      };
    }
  }

  /** Goes to the still: stops any attempt, and destroys the scene at once or after its fade. */
  function settle(fade: boolean): void {
    cancelWait?.();
    cancelWait = null;
    attempt = 0;
    const current = scene;
    scene = null;
    running = false;
    if (idleTimer !== undefined) clearTimeout(idleTimer);
    idleTimer = undefined;
    dragId = null;
    tap = null;
    elements.live.classList.remove('is-ready');
    const controller = current?.controller;
    if (!controller) return;
    if (fade && current.ready) {
      leaving.add(controller);
      later(() => {
        leaving.delete(controller);
        controller.destroy();
      }, toMs(SKY.liveFade.duration));
    } else {
      controller.destroy();
    }
  }

  /** A failure (the import, the data, the scene, or the WebGL context): Still for the visit. */
  function fail(): void {
    floor = 'still';
    update();
  }

  async function make(id: number): Promise<void> {
    try {
      factory ??= await loadLive();
      if (disposed || id !== attempt) return;
      let tier = wanted();
      if (tier === 'still') return update();
      const makeScene = await factory(tier);
      if (disposed || id !== attempt) return;
      tier = wanted();
      if (tier === 'still') return update();
      const made: Scene = { controller: null, tier, ready: false, governor: null };
      scene = made;
      const step = parseSkyStep(html.getAttribute('data-sky-step')) ?? STILL_FALLBACK_STEP;
      const controller = makeScene(elements.live, {
        theme: currentTheme(),
        tier,
        startTimeMs: stepTimeNear(step, Date.now()),
        getProgress: options.getProgress,
        onReady: () => ready(made),
        onFps: (fps) => frameRate(made, fps),
        onError: () => {
          if (scene === made) fail();
        },
        overlay: elements.labels,
      });
      // An error reported while the scene was being made has already sent the sky to Still.
      if (scene !== made) {
        controller.destroy();
        return;
      }
      made.controller = controller;
      const box = elements.root.getBoundingClientRect();
      controller.setSize(box.width, box.height);
      wake();
      attempt = 0;
    } catch {
      // Still for the visit; settling destroys whatever part of the scene was made.
      if (disposed || id !== attempt) return;
      fail();
    }
  }

  /** The scene drew its first frame: fade it in (never before SKY.liveFade.notBefore) and start the probe. */
  function ready(made: Scene): void {
    if (scene !== made || made.ready) return;
    made.ready = true;
    made.governor = createFpsGovernor(performance.now());
    const wait = Math.max(0, firstPaintMs(win) + toMs(SKY.liveFade.notBefore) - performance.now());
    later(() => {
      if (scene === made) elements.live.classList.add('is-ready');
    }, wait);
  }

  function frameRate(made: Scene, fps: number): void {
    if (scene !== made || !running || !made.governor) return;
    if (!made.governor.report(fps, performance.now())) return;
    floor = lowerTier(floor, stepDown(made.tier));
    update(true);
  }

  /** Input (or the tab shown again): runs the frame loop, and rests it after SKY.idlePause without input. */
  function wake(): void {
    lastInput = performance.now();
    const controller = scene?.controller;
    if (!controller || doc.hidden) return;
    if (!running) {
      running = true;
      scene?.governor?.reset(lastInput);
      controller.start();
    }
    if (idleTimer === undefined) idleTimer = setTimeout(checkIdle, idleMs);
  }

  function checkIdle(): void {
    idleTimer = undefined;
    if (!running) return;
    const quiet = performance.now() - lastInput;
    if (quiet >= idleMs) rest();
    else idleTimer = setTimeout(checkIdle, idleMs - quiet);
  }

  function rest(): void {
    if (!running) return;
    running = false;
    scene?.controller?.stop();
  }

  const onVisibility = () => {
    if (doc.hidden) rest();
    else wake();
  };

  // The pointer moves the parallax wherever it is (sheet 3.2); only over empty sky may the scene
  // draw its drafting lines for it.
  const onPointerMove = (event: PointerEvent) => {
    if (event.pointerType === 'touch') return;
    wake();
    const { clientX: x, clientY: y } = event;
    hover = { x, y };
    scene?.controller?.setPointer({ x, y, emptySky: isEmptySky(event.target, x, y) });
  };

  const onPointerOut = (event: PointerEvent) => {
    if (event.relatedTarget !== null || event.pointerType === 'touch') return;
    hover = null;
    scene?.controller?.setPointer(null);
  };

  const onBlur = () => {
    dragId = null;
    tap = null;
    hover = null;
    scene?.controller?.setPointer(null);
  };

  // The page moving under a resting pointer may bring text under it: the drafting lines clear
  // until the pointer moves again and is found on empty sky.
  const onScroll = () => {
    wake();
    if (hover) scene?.controller?.setPointer({ ...hover, emptySky: false });
  };

  /** A press on the page's scrollbar, outside the viewport's content box. */
  const onScrollbar = (event: PointerEvent) => event.clientX >= html.clientWidth || event.clientY >= html.clientHeight;

  const onPointerDown = (event: PointerEvent) => {
    wake();
    tap = null;
    const controller = scene?.controller;
    if (!controller || !event.isPrimary || event.button !== 0 || onScrollbar(event)) return;
    const { clientX: x, clientY: y } = event;
    if (!isEmptySky(event.target, x, y)) return;
    // On a touch screen the ripple waits for the finger to lift: a touch that scrolls the page is
    // taken by the browser (pointercancel) and makes no ripple.
    if (event.pointerType === 'touch') tap = { id: event.pointerId, x, y };
    else controller.ripple(x, y);
  };

  const onPointerUp = (event: PointerEvent) => {
    if (!tap || event.pointerId !== tap.id) return;
    const { x, y } = tap;
    tap = null;
    scene?.controller?.ripple(x, y);
  };

  const onPointerCancel = (event: PointerEvent) => {
    if (tap && event.pointerId === tap.id) tap = null;
  };

  const onTouchStart = (event: TouchEvent) => {
    wake();
    // A second finger (a pinch) ends the drag, and the parallax goes back to the centre.
    if (dragId !== null) scene?.controller?.setPointer(null);
    dragId = null;
    const controller = scene?.controller;
    const touch = event.changedTouches[0];
    if (!controller || event.touches.length !== 1 || !touch) return;
    if (!isEmptySky(event.target, touch.clientX, touch.clientY)) return;
    dragId = touch.identifier;
    controller.setPointer({ x: touch.clientX, y: touch.clientY });
  };

  const onTouchMove = (event: TouchEvent) => {
    wake();
    if (dragId === null) return;
    const touch = touchIn(event.changedTouches, dragId);
    if (touch) scene?.controller?.setPointer({ x: touch.clientX, y: touch.clientY });
  };

  const onTouchEnd = (event: TouchEvent) => {
    if (dragId === null || !touchIn(event.changedTouches, dragId)) return;
    dragId = null;
    scene?.controller?.setPointer(null);
  };

  const themes = new MutationObserver(() => {
    const controller = scene?.controller;
    if (!controller) return;
    controller.setTheme(currentTheme());
    wake();
  });
  themes.observe(html, { attributes: true, attributeFilter: ['data-theme'] });

  const sizes = new ResizeObserver((entries) => {
    const box = entries[entries.length - 1]?.contentRect;
    const controller = scene?.controller;
    if (!box || !controller) return;
    controller.setSize(box.width, box.height);
    wake();
  });
  sizes.observe(elements.root);

  const onSettings = () => update();
  const stopMotionOk = subscribeMotionOk(onSettings);
  const stopPaused = subscribeMotionPaused(onSettings);
  const connection = connectionOf(win);
  connection?.addEventListener?.('change', onSettings);

  doc.addEventListener('visibilitychange', onVisibility);
  win.addEventListener('pointermove', onPointerMove, listen);
  win.addEventListener('pointerout', onPointerOut, listen);
  win.addEventListener('pointerdown', onPointerDown, listen);
  win.addEventListener('pointerup', onPointerUp, listen);
  win.addEventListener('pointercancel', onPointerCancel, listen);
  win.addEventListener('touchstart', onTouchStart, listen);
  win.addEventListener('touchmove', onTouchMove, listen);
  win.addEventListener('touchend', onTouchEnd, listen);
  win.addEventListener('touchcancel', onTouchEnd, listen);
  win.addEventListener('scroll', onScroll, listen);
  win.addEventListener('wheel', wake, listen);
  win.addEventListener('blur', onBlur);

  update();

  return () => {
    disposed = true;
    cancelWait?.();
    cancelWait = null;
    attempt = 0;
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    if (idleTimer !== undefined) clearTimeout(idleTimer);
    themes.disconnect();
    sizes.disconnect();
    stopMotionOk();
    stopPaused();
    connection?.removeEventListener?.('change', onSettings);
    doc.removeEventListener('visibilitychange', onVisibility);
    win.removeEventListener('pointermove', onPointerMove);
    win.removeEventListener('pointerout', onPointerOut);
    win.removeEventListener('pointerdown', onPointerDown);
    win.removeEventListener('pointerup', onPointerUp);
    win.removeEventListener('pointercancel', onPointerCancel);
    win.removeEventListener('touchstart', onTouchStart);
    win.removeEventListener('touchmove', onTouchMove);
    win.removeEventListener('touchend', onTouchEnd);
    win.removeEventListener('touchcancel', onTouchEnd);
    win.removeEventListener('scroll', onScroll);
    win.removeEventListener('wheel', wake);
    win.removeEventListener('blur', onBlur);
    scene?.controller?.destroy();
    scene = null;
    for (const controller of leaving) controller.destroy();
    leaving.clear();
    elements.live.classList.remove('is-ready');
    html.removeAttribute('data-sky-tier');
  };
}
