/**
 * Every number of the site's motion: the eight motion sheets of the design bundle ("Motion, sheet
 * 1 of 8" to "sheet 8 of 8") and the sky's numbers (sheet 3 and the Sky component's README).
 * Components import from here; no component holds a duration of its own (sheet 1.1). Each group
 * names the sheet it comes from.
 *
 * Units: times in seconds, as Motion takes them (multiply by 1,000 for timers and
 * performance.now(), or use `toMs`); distances in CSS px unless a comment names drawing units;
 * angles in degrees. Easings are cubic Bezier arrays for Motion's `ease`, with the same curves as
 * CSS strings in `easeCss`. Springs are Motion transitions by visual duration and bounce, with the
 * same springs by stiffness and damping in `springPhysics` for any other engine.
 *
 * No colors live here: the sky reads its colors from app/tokens.css at run time. No imports
 * either, so a Node script can load this file directly, as scripts/check-content.mjs loads
 * lib/lint.ts.
 */

/** A cubic Bezier curve, [x1, y1, x2, y2], as Motion takes it in `ease`. */
export type Bezier = readonly [number, number, number, number];

/** A spring as Motion takes it in `transition`: by visual duration (seconds) and bounce. */
export type SpringTransition = {
  readonly type: 'spring';
  readonly visualDuration: number;
  readonly bounce: number;
};

/** The same spring by physics, for mass 1, for an engine other than Motion. */
export type SpringPhysics = {
  readonly stiffness: number;
  readonly damping: number;
  readonly mass: number;
};

/** Seconds to whole milliseconds, for timers, performance.now() and CSS custom properties. */
export function toMs(seconds: number): number {
  return Math.round(seconds * 1000);
}

// ---------------------------------------------------------------------------------------------
// Sheet 1: rules and tokens
// ---------------------------------------------------------------------------------------------

/** Sheet 1.1 and 8.3: the rules that carry a number. */
export const rules = {
  /** Every animation holds 60 frames a second on a mid-range phone, or it is cut. */
  fps: 60,
  /** Nothing flashes more than three times a second. */
  maxFlashesPerSecond: 3,
} as const;

/** Sheet 1.2: the durations. Every timed motion uses one of these. */
export const dur = {
  /** 120 ms: a button or icon button sinks 1 px while pressed. */
  press: 0.12,
  /** 150 ms: hover fills, link underlines, arrow nudges, the lens and star names fading in, a poster giving way to its video. */
  quick: 0.15,
  /** 200 ms: callout strokes, the glass highlight, the lightbox, the 3D view switch, a panel of results. */
  short: 0.2,
  /** 250 ms: the card to project page transition. */
  page: 0.25,
  /** 300 ms: a panel rising into view, the filter reflow, the theme cross-fade. */
  base: 0.3,
  /** 320 ms: the phone menu unrolling. */
  sheet: 0.32,
  /** 240 ms: the phone menu rolling back up. */
  sheetBack: 0.24,
  /** 400 ms: one headline line setting (lines start `delay.lineStep` apart). */
  line: 0.4,
  /** 560 ms: the scan band crossing the drawing once on a phone. */
  scan: 0.56,
  /** 600 ms: the live sky fading in over its still image. */
  fade: 0.6,
  /** 700 ms: one meteor streak. */
  meteor: 0.7,
  /** 800 ms: a readout counting up, once. */
  count: 0.8,
  /** 900 ms: the hero drawing stroking itself in. */
  stroke: 0.9,
  /** 1,200 ms: the hero model easing back to its three-quarter view. */
  return: 1.2,
  /** 1,400 ms: a ripple crossing the ground grid. */
  ripple: 1.4,
  /** 1,400 ms: one pass of the loading line along a well's foot (after `delay.loadingWait`). */
  loading: 1.4,
} as const;

/** Sheet 1.5: delays and staggers. */
export const delay = {
  /** Headline lines start 60 ms apart. */
  lineStep: 0.06,
  /** The hero drawing starts stroking in at 200 ms. */
  strokeStart: 0.2,
  /** The phone scan band starts at 1,000 ms. */
  scanStart: 1.0,
  /** Readouts count up 40 ms apart. */
  readoutStep: 0.04,
  /** Panels that come into view together start 60 ms apart. */
  panelStep: 0.06,
  /** The phone menu's first link sets 80 ms after the sheet starts to unroll. */
  menuStart: 0.08,
  /** The phone menu's links set 40 ms apart. */
  menuStep: 0.04,
  /** The loading line waits 600 ms before its first pass. */
  loadingWait: 0.6,
  /** The hero model waits 1.5 s after the last input before easing back. */
  modelReturnWait: 1.5,
} as const;

/** Sheet 1.3: the easing curves, for Motion's `ease`. */
export const ease = {
  /** Arriving: panels, the menu, headline lines, strokes, callouts. The system's --ease-out. */
  settle: [0.2, 0.7, 0.2, 1],
  /** Travelling between two places: the shared cover, a model going back to its view. */
  move: [0.65, 0, 0.35, 1],
  /** Leaving: the menu rolling up, the lightbox closing. */
  exit: [0.4, 0, 1, 1],
  /** Opacity alone: highlights, cross-fades, the live sky. CSS ease-out. */
  fade: [0, 0, 0.58, 1],
  /** Scroll-linked values and constant speeds: the scan band, the loading line, a video's progress, the ticker. */
  linear: [0, 0, 1, 1],
} as const satisfies Record<string, Bezier>;

/** A Bezier curve as a CSS timing function: `linear`, or `cubic-bezier(x1, y1, x2, y2)`. */
export function cssEasing(curve: Bezier): string {
  const [x1, y1, x2, y2] = curve;
  return x1 === 0 && y1 === 0 && x2 === 1 && y2 === 1 ? 'linear' : `cubic-bezier(${x1}, ${y1}, ${x2}, ${y2})`;
}

/** Sheet 1.3: the same curves as CSS timing functions. */
export const easeCss = {
  settle: cssEasing(ease.settle),
  move: cssEasing(ease.move),
  exit: cssEasing(ease.exit),
  fade: cssEasing(ease.fade),
  linear: cssEasing(ease.linear),
} as const satisfies Record<keyof typeof ease, string>;

/** Sheet 1.4: the springs, as Motion transitions by visual duration and bounce. */
export const spring = {
  /** The thermal lens following the pointer or the finger: it trails a little and settles without a wobble. */
  lens: { type: 'spring', visualDuration: 0.25, bounce: 0.15 },
  /** The lens drifting back to its rest point when the pointer leaves the drawing. */
  rest: { type: 'spring', visualDuration: 0.6, bounce: 0 },
  /** Card tilt and the highlight on its glass, in and out. */
  tilt: { type: 'spring', visualDuration: 0.3, bounce: 0 },
  /** Gallery snap after a drag, Previous and Next, arrow keys. */
  snap: { type: 'spring', visualDuration: 0.4, bounce: 0 },
  /** A video's time following scroll, so seeking never stutters. */
  scrub: { type: 'spring', visualDuration: 0.2, bounce: 0 },
} as const satisfies Record<string, SpringTransition>;

/**
 * Sheet 1.4: the same springs by stiffness and damping, for mass 1, as the sheet prints them.
 * Motion would derive these itself; tests/motion.test.ts checks that both forms move alike.
 */
export const springPhysics = {
  lens: { stiffness: 439, damping: 35.6, mass: 1 },
  rest: { stiffness: 76, damping: 17.5, mass: 1 },
  tilt: { stiffness: 305, damping: 34.9, mass: 1 },
  snap: { stiffness: 171, damping: 26.2, mass: 1 },
  scrub: { stiffness: 685, damping: 52.4, mass: 1 },
} as const satisfies Record<keyof typeof spring, SpringPhysics>;

/** Sheet 1.5: distances in px. */
export const px = {
  /** A panel rises 16 px as it comes into view. */
  panelRise: 16,
  /** A phone menu link drops 8 px as it sets. */
  menuDrop: 8,
  /** An arrow nudges 3 px to the right. */
  nudge: 3,
  /** A button sinks 1 px while pressed. */
  press: 1,
  /** The hero lens is 220 px across at a 1440 px wide window. */
  lens: 220,
} as const;

/** Sheet 1.5: angles in degrees, and the card perspective in px. */
export const deg = {
  /** A card tilts up to 4 degrees toward the pointer. */
  card: 4,
  /** The featured card tilts up to 2 degrees. */
  featured: 2,
  /** The perspective of the card tilt, in px. */
  perspective: 1000,
  /** The wing rotors at cruise: at 90 the disc would fold to a line in plan view. */
  rotorCruise: 82,
  /** A 3D model's slow turn, in degrees a second: one turn a minute. */
  autoTurn: 6,
} as const;

/** Sheet 1.5 and 2.4: sessionStorage keys. */
export const once = {
  /** The load sequence plays once a visit. */
  intro: 'ar-intro-seen',
} as const;

/** D-67 and Q-38: localStorage keys, kept by the browser from one visit to the next. */
export const stored = {
  /**
   * The visitor's pause-motion choice: "1" while motion is paused, absent otherwise. The head
   * script (lib/theme.ts) reads it before the first paint; lib/motionPause.ts reads and writes it.
   */
  motionPaused: 'motion-paused',
} as const;

// ---------------------------------------------------------------------------------------------
// Sheet 2: the load sequence (once a visit, on the home page)
// ---------------------------------------------------------------------------------------------

/**
 * Sheet 2: the load sequence. Under reduced motion none of it plays (sheet 8.1). lib/intro.ts
 * decides which page view plays it and marks the hero section while it does: the headline's times
 * count from the first mark (data-intro), set before the first paint; the drawing's from the
 * second (data-intro-go), set once the whole drawing is in the page, usually the same moment.
 */
export const load = {
  /** The timed part ends by 1,600 ms. */
  end: 1.6,
  /**
   * Headline: split by line, never by letter. Each line rises 0.35 em into place while its
   * opacity goes from 0 to 1. If the sequence has not started 1,200 ms after first paint, CSS
   * sets the headline in place and the sequence is skipped.
   */
  headline: { start: 0, rise: 0.35, duration: dur.line, step: delay.lineStep, ease: ease.settle, giveUpAfter: 1.2 },
  /** Drawing: every path draws from pathLength 0 to 1, all together. */
  drawing: { start: delay.strokeStart, duration: dur.stroke, ease: ease.settle },
  /** Desktop lens: fades in at its rest point when the strokes end (0.2 s plus 0.9 s). */
  lens: { start: 1.1, duration: dur.quick, ease: ease.fade },
  /** Phone and tablet scan: one band, 0.22 of the drawing's width, crosses left to right once. */
  scan: { start: delay.scanStart, duration: dur.scan, width: 0.22, ease: ease.linear },
  /**
   * Readouts count up on first view, with 0.3 of the row visible, 40 ms apart.
   *
   * Not on the sheet: `near`, how close the row is, in window heights, when AnimateNumber starts
   * to load (components/sheet/readoutCount.ts); `giveUpAfter`, how long the row may be in view
   * with its count not started (a slow network) before the values are set at once: the
   * headline's give-up time, since nothing in the sequence stays hidden (sheet 2.4).
   */
  readouts: { inView: 0.3, duration: dur.count, step: delay.readoutStep, ease: ease.settle, near: 1, giveUpAfter: 1.2 },
  /** The live sky fades in over the still once its first frame is drawn, never before 400 ms. */
  sky: { notBefore: 0.4, duration: dur.fade, ease: ease.fade },
  /** sessionStorage key: back on the home page in the same visit, everything paints final. */
  onceKey: once.intro,
} as const;

// ---------------------------------------------------------------------------------------------
// Sheet 3: the sky (with the Sky component's README and the reference renderer)
// ---------------------------------------------------------------------------------------------

/**
 * Sheet 3 and the Sky README: the sky's numbers. The flat keys keep the reference renderer's
 * names (its `SKY`), so a port of it reads the same; the groups hold the numbers the reference
 * writes inline. Times in seconds, distances in px at depth 1, angles in degrees.
 */
export const SKY = {
  /** Santa Clara, California: latitude north and longitude east, in degrees (west is negative). */
  site: { lat: 37.354, lon: -121.955 },
  /** Azimuth of the view's centre, in degrees from north through east: north-east. */
  facing: 45,
  /** Degrees of sky above the horizon at the top edge on wide screens (more on phones). */
  altitudeTop: 60,
  /** The horizon's height as a share of the viewport height, from the top (--horizon in app/tokens.css). */
  horizon: 0.8,
  /** The dawn's opacity at the top of a page; it holds here under reduced motion. */
  dawnMin: 0.06,
  /** The dawn's opacity at the end of a page (--dawn-max). Linked to scroll with no easing. */
  dawnMax: 0.32,
  /** The Milky Way photograph stays dim: its brightest pixel adds under 60, 56 and 52 to the sky. */
  milkyWayExposure: 0.5,
  /** The Light tier's magnitude limit: about 2,500 stars. */
  lightTierLimit: 5.35,
  /** The sky turns 20 times faster than the real sky: about 5 degrees a minute. */
  speed: 20,
  /** Seconds between meteors, at random in this range; at most one at a time, Full tier only. */
  meteorEvery: [10, 20],
  /** Seconds without pointer, touch or scroll input before rendering pauses. */
  idlePause: 30,
  /** Degrees the sky turns further about the pole between the top and the end of a page. */
  scrollTurn: 4,
  /** Ground grid rows that pass between the top and the end of a page. */
  scrollRows: 6,
  /** Magnitudes of dimming per airmass: stars and the Milky Way fade toward the horizon. */
  extinction: 0.25,

  /** Stars brighter than this magnitude get the soft halo and fine diffraction spikes (README). */
  haloLimit: 1.6,
  /** Rows in the Yale Bright Star Catalogue, 5th revised edition (README). */
  catalogueStars: 9096,
  /** Only the brightest 150 stars keep a name; a star with no IAU name gets no label. */
  namedStars: 150,

  /** Seconds for one ground row to pass, as if in flight. */
  rowPeriod: 5,

  /**
   * Pointer and touch parallax. A star shifts up to `x` px across and `y` px up and down at depth
   * 1; its depth comes from its parallax in milliarcseconds: `depth.nearMas` and nearer is depth
   * 1, and no star is under `depth.min` (lib/sky/astro.ts depthFromParallax). The Milky Way moves
   * least; the ground's vanishing point leans with the pointer. The pointer is smoothed with a
   * 120 ms time constant.
   */
  parallax: {
    x: 12,
    y: 8,
    milkyWayX: 2,
    milkyWayY: 1.5,
    vanishingPoint: 40,
    smoothing: 0.12,
    depth: { nearMas: 100, min: 0.05 },
  },

  /**
   * Drafting lines, Full tier only. After the pointer rests 350 ms, lines join up to four stars
   * brighter than magnitude 2.6 within 230 px, each in a 12 px box in the line color; the lines
   * draw in 200 ms (settle), then the brightest named star's name fades in over 150 ms, in B612
   * Mono 13 px. Everything clears at once when the pointer moves.
   */
  drafting: {
    rest: 0.35,
    near: 230,
    brightLimit: 2.6,
    maxStars: 4,
    box: 12,
    draw: dur.short,
    drawEase: ease.settle,
    nameAfter: dur.short,
    nameFade: dur.quick,
    nameEase: ease.fade,
    nameSize: 13,
    /** From the reference renderer: the lines and boxes at 0.85 opacity, 1 px wide; the name 12 px right of and above its star. */
    lineAlpha: 0.85,
    lineWidth: 1,
    nameOffset: 12,
  },

  /**
   * A click or tap on empty sky: one ripple from that point, growing to 0.7 of the width and 0.22
   * as tall as wide, its opacity going from 0.8 to 0 over 1,400 ms, linear. A new one replaces it.
   * The reference renderer strokes it 1.5 px wide.
   */
  ripple: { width: 0.7, aspect: 0.22, opacity: 0.8, duration: dur.ripple, ease: ease.linear, lineWidth: 1.5, minRadius: 1 },

  /**
   * One meteor: 260 px of travel with a 90 px tail, in 700 ms, linear (with `meteorEvery`). From
   * the reference renderer: a 1.2 px streak, 0.85 opaque at its head (fading as it travels) and
   * clear at its tail. It starts at random between `start.x` of the width and between `start.y`
   * of the horizon's height from the top, and moves `direction.y` down for each px of
   * `direction.x` (chosen at random in that range: right to left).
   */
  meteor: {
    travel: 260,
    tail: 90,
    duration: dur.meteor,
    ease: ease.linear,
    width: 1.2,
    headAlpha: 0.85,
    start: { x: [0.25, 0.85], y: [0.08, 0.43] },
    direction: { x: [-0.75, -1], y: 0.55 },
  },

  /** Stars brighter than magnitude 2 vary up to 8% either way, on a 1.9 s sine, out of step. */
  shimmer: { limit: 2, depth: 0.08, period: 1.9 },

  /** The live sky fades in over the still once its first frame is drawn, never before 400 ms (sheet 2). */
  liveFade: load.sky,

  /** A tier steps down (Full to Light, Light to Still) when the frame rate stays under 45 for 2 s. */
  demoteBelowFps: 45,
  demoteAfter: 2,

  /** Device pixel ratio caps by tier. */
  dpr: { full: 2, light: 1.5 },

  /**
   * The numbers the reference renderer (the design bundle's Sky component, its drawSky, drawGround
   * and drawRipple) writes inline, for the WebGL scene in components/sky/live. Distances in CSS
   * px, opacities 0 to 1.
   */
  scene: {
    /** The sky's gradient runs zenith, mid at this share of the way down, low at the horizon. */
    skyMidStop: 0.55,
    /** Gradients are dithered by this many 8-bit steps, as the browser dithers a canvas gradient. */
    dither: 1,
    /** The Milky Way photograph's black level, removed before the exposure: 14 of 255. */
    milkyWayBlack: 14,
    /**
     * The reference maps the Milky Way at a quarter of the resolution, 4 CSS px to a layer pixel:
     * the shader reads the panorama over the same footprint (a mipmap level), so the band and its
     * dust lanes stay smooth and the photograph's own stars, which the catalogue draws, stay out.
     */
    milkyWayLayer: 4,
    /**
     * The ESO panorama's own frame sits a little off the galactic grid: its pictures of bright
     * stars lie 2 to 4 degrees from the catalogue's, which drew soft ghosts beside them. This is
     * the rotation that takes a true galactic direction to the panorama's frame, as a rotation
     * vector in degrees about the galactic x, y and z axes (fitted on 77 bright stars: median
     * residual 0.12 degrees). The reference renderer reads the panorama without it.
     */
    milkyWayFrame: { x: -1.06, y: -1.73, z: -3.23 },
    /** How often the scene reports its frame rate while running, in seconds. */
    fpsEvery: 0.5,
    star: {
      /**
       * No star fainter than this, after extinction, is drawn; the Full tier draws the catalogue to
       * here, as the reference does. Sheet 3.4 describes the Full tier as "about 9,000 stars to
       * magnitude 6.5", the catalogue's nominal limit; its faintest rows reach about 8, and the
       * reference draws all of them (9,095).
       */
      limit: 8,
      /** Stars at or below this altitude, in degrees, are not drawn. */
      minAltitude: 0.3,
      /** Stars further than this outside the window are not drawn. */
      margin: 10,
      /** Radius from magnitude v: max(min, base - slope v). Under `squareBelow` a star is a square, not a disc. */
      radius: { base: 2.4, slope: 0.36, min: 0.45, squareBelow: 1 },
      /** Opacity from magnitude v: base - slope v, held between min and max. */
      alpha: { base: 1.05, slope: 0.13, min: 0.16, max: 1 },
      /** Under SKY.haloLimit: a radial glow out to `glow` radii, opening at `alpha`. */
      glow: { radius: 5.5, alpha: 0.32 },
      /** Under SKY.haloLimit: diffraction spikes reaching `length` radii each way, `width` px wide. */
      spikes: { length: 7, width: 0.6, alpha: 0.32 },
    },
    /**
     * The ground grid: lines from the vanishing point on the horizon to the bottom edge, `lines`
     * on each side of the centre, a `bottomSpacing` share of the width apart there, opening from
     * clear at the horizon to `lineAlpha` at the bottom; `rows` rows, `rowStep` apart in depth
     * (the ground phase moves one row in SKY.rowPeriod seconds), at `lineAlpha` and fading toward
     * the horizon over a `rowFade` share of the ground; the horizon line at `horizonAlpha`. Every
     * line is `lineWidth` px wide.
     */
    ground: {
      lines: 14,
      bottomSpacing: 1 / 9,
      rows: 22,
      rowStep: 0.55,
      lineAlpha: 0.42,
      rowFade: 0.6,
      horizonAlpha: 0.65,
      lineWidth: 1,
      /** A row is drawn only this far inside the ground (below the horizon, above the bottom edge), and the ripple clipped this far below the horizon, as the reference culls them. */
      edge: 1,
    },
  },

  /**
   * Choosing the tier at start (sheet 3.4 and the Phase 5 brief, decision 6). Light: a coarse
   * pointer, or deviceMemory or hardwareConcurrency of 4 or less. Then a frame-time probe over
   * the first second: at or under 12 ms a frame keeps the tier, 12 to 22 ms is Light, over 22 ms
   * is Still. A tier never steps back up during a visit.
   *
   * `fullFrameMs` is the sheet's line and is not applied: the scene reports frames a second,
   * which the screen's refresh caps (16.7 ms a frame at 60 Hz), so only `lightFrameMs` can decide
   * (lib/sky/tier.ts). Changing it changes nothing until the scene reports its own frame cost.
   *
   * `stall`: a frame-rate report that spans more than this many seconds (twice
   * SKY.scene.fpsEvery) covers a stall of the page's main thread, which says nothing about the
   * sky's own frame rate, so it does not start a run of slow reports (a run already under way
   * goes on).
   */
  tiers: {
    lightMemoryGb: 4,
    lightCores: 4,
    probe: 1,
    fullFrameMs: 12,
    lightFrameMs: 22,
    stall: 1,
  },

  /**
   * Loading the live sky's chunk (Phase 5 brief, decision 8; R-05), in components/sky/host.ts:
   * never before the load event, then in the browser's next idle period, waited for at most
   * `idleTimeout` seconds. Where the browser has no requestIdleCallback, the import starts
   * `noIdleDelay` seconds after the load event instead. The scene then prepares its data in
   * yielding steps of at most `slice` seconds of work each, so its start makes no long task.
   *
   * `uploadWaitFrames` (site, Phase 7): the scene's first draw waits for a fence after the Milky
   * Way's upload to the GPU for at most this many frames (about half a second at 60 Hz), so that
   * draw does not stall on a texture still being copied; after that it draws anyway.
   */
  liveLoad: { idleTimeout: 2, noIdleDelay: 0.2, slice: 0.008, uploadWaitFrames: 30 },
} as const;

// ---------------------------------------------------------------------------------------------
// The sky's files: the still images and the byte budgets
// ---------------------------------------------------------------------------------------------

/**
 * The sky's still images (Phase 5 brief, decision 7; docs/V3_PLAN.md 5.7 and D-68) and the byte
 * budgets of the sky's files and code (ARCHITECTURE.md 9; R-05). scripts/render-stills.mjs draws
 * the stills through the live scene, scripts/check-sky.mjs checks every file before each build
 * (and, with --build, the built chunks after it), and components/sky/Sky.tsx reads the stills'
 * sizes to place them. Each class's scene is drawn `width` by `height` CSS px at `dpr` device px to
 * the CSS px, on the tier the devices of that class run live (phones and tablets Light, desktops
 * Full), so the live sky fading in over its still adds or drops no star. Each WebP image fits
 * `budget` bytes, at a WebP quality of `minQuality` or more. Budgets in bytes.
 *
 * Shapes: the page shows the part of a still above the horizon scaled by the window's projection
 * scale over the still's, about the horizon's centre, and stretches its ground to the window
 * (app/sheet.css 23), so the live sky lands on it in any window. That covers the window when the
 * still is of the window's kind. The view's scale follows the window's height above SKY.horizon
 * times PROJECTION.top over PROJECTION.wide (about 1.148 to 1, lib/sky/astro.ts): windows
 * narrower than that (phones, tablets upright) take a still drawn at the other switch,
 * SKY.horizon times PROJECTION.cap over PROJECTION.wide (about 0.7233 to 1), and wider windows
 * (desktops, a phone on its side) take a 2.7 to 1 still, which covers windows up to 2.7 to 1,
 * ultrawide monitors included. tests/sky-host.test.ts checks the shapes against these switches.
 *
 * `liveChunk` is the sky's deferred JavaScript, three.js's share included, and `firstLoad` the home
 * page's first-load JavaScript, both brotli-compressed (ARCHITECTURE.md 9; R-05 measures brotli).
 */
export const skyFiles = {
  stills: {
    phone: { width: 521, height: 720, dpr: 1.5, tier: 'light', budget: 60_000 },
    tablet: { width: 834, height: 1153, dpr: 1.5, tier: 'light', budget: 80_000 },
    desktop: { width: 2160, height: 800, dpr: 1.5, tier: 'full', budget: 110_000 },
  },
  minQuality: 0.5,
  /** public/sky/stars.bin, the Light tier's Milky Way (public/sky/milkyway-2k.webp), and the code. */
  budgets: { stars: 150_000, milkyWayLight: 400_000, liveChunk: 220_000, firstLoad: 160_000 },
} as const;

// ---------------------------------------------------------------------------------------------
// Sheet 4: the hero aircraft
// ---------------------------------------------------------------------------------------------

/** Sheet 4: the plan view of Raven, its thermal lens, the phone scan and the rotor tilt. */
export const hero = {
  /** The drawing's box, in drawing units. */
  drawing: { width: 600, height: 560 },
  /**
   * The pointer lens (desktop, mouse and pen only): radius 128 drawing units, which is `px.lens`
   * (220 px) across at a 1440 px window, with four short ticks outside the ring. It rests over the
   * battery bay, its centre stays inside the inner frame, it follows with the lens spring and goes
   * back with the rest spring. While it follows, its ring is the Motion+ `Cursor` (DESIGN_DIRECTION.md
   * 6.4; ARCHITECTURE.md 8).
   *
   * `load` (no sheet gives it; the sky's rule, SKY.liveLoad): the Cursor's code is not needed at
   * first paint, since the lens appears only after the strokes (load.lens.start). It loads once the
   * load sequence has ended, in the browser's next idle period (waited for at most `idleTimeout`
   * seconds, or `noIdleDelay` seconds where there is no requestIdleCallback), or at once when a
   * mouse or a pen first comes over the drawing.
   */
  lens: {
    radius: 128,
    acrossPx: px.lens,
    atWindow: 1440,
    ticks: 4,
    rest: { x: 300, y: 196 },
    frame: { left: 40, right: 560, top: 40, bottom: 520 },
    follow: spring.lens,
    back: spring.rest,
    load: { idleTimeout: SKY.liveLoad.idleTimeout, noIdleDelay: SKY.liveLoad.noIdleDelay },
  },
  /**
   * Phones and tablets: one scan band (load.scan: 0.22 of the drawing, 132 units), then press and
   * drag. The lens fades in at the finger over 150 ms, follows with the lens spring, holds 1,200 ms
   * after the finger lifts (a tap that does not move shows it for the same time), then fades out
   * over 300 ms. When the browser takes the gesture (pointercancel) it fades out over 150 ms.
   */
  touch: {
    fadeIn: dur.quick,
    follow: spring.lens,
    hold: 1.2,
    fadeOut: dur.base,
    cancelFadeOut: dur.quick,
    ease: ease.fade,
  },
  /**
   * Scroll-tied rotor tilt, linear and clamped, with no easing: hover (0 degrees) to cruise
   * (82 degrees), each nacelle moving 26 drawing units forward; the tail rotor never tilts. A 3D
   * model's RotorL and RotorR nodes turn 0 to 90 degrees.
   *
   * From the Hero boards (Hero-1440-Rest and Hero-1440-Cruise, drawn by the canvas's Main board):
   * `podGrow`, the drawing units the front of each wing motor's pod moves forward by cruise while
   * its back stays put, so the pod reads longer as it tips forward; and `fade`, how much a part
   * fades by cruise (its opacity is 1 minus fade times the tilt's progress): the wing blades go
   * (the discs read edge-on), the tail rotor's disc and blade dim by 0.6 and its heat in the
   * thermal view by 0.55.
   */
  rotor: {
    hover: 0,
    cruise: deg.rotorCruise,
    nacelleShift: 26,
    modelMax: 90,
    podGrow: 30,
    fade: { blades: 1, tail: 0.6, tailHeat: 0.55 },
  },
  /** Reduced motion: the static split at 300 drawing units, divided by a 1 px line. */
  split: { at: 300, line: 1 },
  /**
   * The owner's 3D model in the hero: back to its three-quarter view 1.5 s after the last input,
   * over 1,200 ms (move); views cross-fade in 200 ms; on phones a slow turn after a tap.
   */
  model: {
    returnWait: delay.modelReturnWait,
    returnDuration: dur.return,
    returnEase: ease.move,
    viewFade: dur.short,
    viewEase: ease.fade,
    phoneTurn: deg.autoTurn,
    /**
     * Sheet 1.2 (quick: "the lens fading in"): the lens over the model fades in at its rest point
     * when it may show (the Realistic view, a mouse or a pen, motion allowed, the engine drawing)
     * and out where it is when it may no longer, 150 ms each way. Sheet 4.5 gives it the drawing's
     * size and springs: it follows with hero.lens.follow and goes back with hero.lens.back.
     */
    lensFade: { duration: dur.quick, ease: ease.fade },
    /**
     * The Hero-1440-Realistic board: the lens rests 56% across and 38% down the model's box, which
     * runs from 4% to 90% of the stage's height, and the pointer leaving sends it back there. In the
     * drawing's units, since the stage is the drawing's 600 by 560 box: 0.56 of 600 across, and
     * 0.04 + 0.86 x 0.38 = 0.3668 of 560 down.
     */
    lensRest: { x: 336, y: 205.4 },
    /**
     * Sheet 1.2 (quick: "a poster giving way to its video"): the hero's poster, captured in the
     * admin under a neutral light, fades out over the first frame lit by the sky, 150 ms; without
     * motion it goes at once.
     */
    posterOut: { duration: dur.quick, ease: ease.fade },
    /**
     * Sheet 4.5: on desktop the engine loads after the page is interactive, read as the sky's rule
     * (SKY.liveLoad): after the load event, in the browser's next idle period (waited for at most
     * `idleTimeout` seconds), or `noIdleDelay` seconds after the load event where the browser has
     * no requestIdleCallback; then once the stage is within media.model.loadMargin of the view.
     */
    afterInteractive: { idleTimeout: SKY.liveLoad.idleTimeout, noIdleDelay: SKY.liveLoad.noIdleDelay },
  },
} as const;

// ---------------------------------------------------------------------------------------------
// Sheet 5: cards and glass
// ---------------------------------------------------------------------------------------------

/** Sheet 5: a project card answering the pointer. Touch gets no tilt, highlight or callouts. */
export const cards = {
  /** Mouse and pen only; never on touch or keyboard focus. */
  tilt: { max: deg.card, featured: deg.featured, perspective: deg.perspective, spring: spring.tilt },
  /** A 1 px light along the glass rim, following the pointer through the tilt spring. */
  highlight: { width: 1, in: dur.short, out: dur.short, ease: ease.fade, spring: spring.tilt },
  /** Dimension callouts over the cover, undrawn in reverse on leave. */
  callouts: {
    lines: { start: 0, duration: dur.short, ease: ease.settle },
    arrowheads: { start: 0.12, duration: dur.press, ease: ease.fade },
    plates: { start: 0.08, duration: dur.quick, ease: ease.fade },
  },
  /** A video cover: the poster gives way in 150 ms; a 2 px progress line runs along the foot. */
  video: { posterOut: dur.quick, posterEase: ease.fade, progressLine: 2, progressEase: ease.linear },
  /** A model cover turns 28 degrees either way on a 6 s sine while hovered, back with the tilt spring. */
  model: { swing: 28, cycle: 6, back: spring.tilt },
  /** On the featured card the arrow after "Open project" moves 3 px to the right. */
  openCue: { nudge: px.nudge, duration: dur.quick, ease: ease.fade },
  /** Phones: a video or model cover runs while its card is at least 0.6 in view, one at a time. */
  phoneInView: 0.6,
  /**
   * Sheet 5, Phones ("the one most in view"): the share of each card in view is reported in this
   * many even steps from `phoneInView` to 1, so the cover most in view can be told apart.
   */
  phoneInViewSteps: 8,
} as const;

// ---------------------------------------------------------------------------------------------
// Sheet 6: video, 3D models and the gallery
// ---------------------------------------------------------------------------------------------

/** Sheet 6: the owner's media. */
export const media = {
  /**
   * Video plays muted while at least 0.6 of it is in view, one at a time; the poster gives way in
   * 150 ms; the file starts loading when the block is within 200 px of the view.
   *
   * `shareStep`: how finely "the one most in view" is told apart (sheet 6.1 gives no number). The
   * share of each video in view is measured in tenths; two videos whose shares round to the same
   * tenth count as equally in view, and the one already playing keeps playing
   * (components/viewers/video/playback.ts).
   */
  video: { inView: 0.6, posterOut: dur.quick, posterEase: ease.fade, preloadMargin: 200, shareStep: 0.1 },
  /**
   * Scroll-scrubbed video: 100 px of scroll for each second of video, a run of at least one and at
   * most three screen heights, time through the scrub spring. Encode the scrub file with a
   * keyframe every 0.5 s, or every frame for clips under 20 s.
   *
   * `endGuard` (sheet 6.2 gives no number): the run ends this many seconds before the file does, so
   * the last frame shows without the video ending.
   */
  scrub: {
    pxPerSecond: 100,
    minScreens: 1,
    maxScreens: 3,
    spring: spring.scrub,
    keyframeEvery: 0.5,
    everyFrameUnder: 20,
    endGuard: 0.05,
  },
  /**
   * 3D models: the engine loads within 200 px of the view on desktop, at most two viewers render
   * at a time; the model turns 6 degrees a second until first touched; orbit and zoom ease with a
   * damping of 0.08 a frame (a glide of about 0.6 s); pitch from 10 degrees below the horizon to 60
   * above; zoom from 0.6 to 2 times the fitted distance; reset in 600 ms (move); views cross-fade
   * in 200 ms; the exploded view moves parts up to 0.6 of the model's radius, arrow keys step 0.1
   * in 160 ms (settle); the drag hint ("Drag to orbit") sits under the viewer until the first drag,
   * then fades out over 150 ms (removed at once under reduced motion).
   */
  model: {
    loadMargin: 200,
    maxLive: 2,
    autoTurn: deg.autoTurn,
    damping: 0.08,
    glide: 0.6,
    pitchMin: -10,
    pitchMax: 60,
    zoomMin: 0.6,
    zoomMax: 2,
    reset: { duration: dur.fade, ease: ease.move },
    viewFade: { duration: dur.short, ease: ease.fade },
    explode: { max: 0.6, keyStep: 0.1, keyDuration: 0.16, keyEase: ease.settle },
    hintFade: { duration: dur.quick, ease: ease.fade },
  },
  /**
   * The gallery: on release it glides on its own momentum (Motion's inertia options, which take
   * the time constant in milliseconds), then snaps; past either end it stretches at a fifth of the
   * pointer's travel. The lightbox opens in 200 ms (fade) and closes in 150 ms (exit). A frame
   * loading holds its size; after 600 ms a 2 px line runs along its foot, 1,400 ms a pass; the
   * photo fades in over 200 ms.
   *
   * The strip is Motion+ Carousel (components/viewers/image/Gallery.tsx), and the numbers reach it
   * so: `snap` is its `transition` (the snap after a release, Previous, Next, the arrow keys, a
   * wheel swipe), and `overdrag` its `dragElastic`. `glide` has no Carousel option: with snapping
   * on, Carousel projects the release velocity 0.3 s ahead, picks the frame there, and carries the
   * release velocity into the snap spring, so the glide and the snap are one motion of 0.4 s.
   * `glide` stays the sheet's record (Motion's own inertia defaults). Carousel's other spring, the
   * bounce it plays when a wheel swipe meets an end, is not the sheets' (the snap spring has no
   * bounce): the gallery keeps such a wheel from Carousel, so a wheel at an end does nothing.
   *
   * `atOnce` (sheet 8.1, reduced motion): the strip's moves, a button's or a key's included, take
   * no time. No wheel swipe pages the strip then: a wheel moves it directly, within its ends, and
   * it settles on the nearest frame at once, as a released drag does.
   *
   * `wellOut` (sheet 6.4 gives no number): once the photo has faded in over the loading well, the
   * well fades out under it and is removed. It shows only where the photo leaves the well uncovered
   * (a transparent photo, a contained one), which then never cuts from the well to the night
   * behind it (components/viewers/image/arrival.tsx).
   */
  gallery: {
    glide: { power: 0.8, timeConstant: 325 },
    snap: spring.snap,
    overdrag: 0.2,
    atOnce: { duration: 0 },
    lightboxIn: { duration: dur.short, ease: ease.fade },
    lightboxOut: { duration: dur.quick, ease: ease.exit },
    loadingLine: { wait: delay.loadingWait, duration: dur.loading, width: 2, ease: ease.linear },
    photoIn: { duration: dur.short, ease: ease.fade },
    wellOut: { duration: dur.short, ease: ease.fade },
  },
} as const;

// ---------------------------------------------------------------------------------------------
// Sheet 7: page motion
// ---------------------------------------------------------------------------------------------

/** Sheet 7: what moves as the visitor reads and moves around the site. */
export const page = {
  /**
   * A 2 px line under the nav (--heat-rule-height in app/tokens.css) whose length is the page
   * progress, linked to scroll with no lag (linear). The ramp is fixed to the page width, so the
   * line runs cold to hot as the page is read: components/site/HeatRule.tsx draws it as a window
   * that slides in from the left over the ramp, which counter-slides (chromeMotion.ts).
   */
  heatRule: { height: 2, ease: ease.linear },
  /**
   * The lit zone, from a 1024 px frame: the zone letter and its 2 px bar move at once, as a state,
   * to the zone of the page progress (A for the first sixth of the page, F for the last).
   */
  litZone: { minWidth: 1024, bar: 2 },
  /**
   * Panels coming into view after the first paint rise 16 px and fade in, once per page view,
   * when their top passes 0.85 of the window height; together they start 60 ms apart, at most
   * three to a group (a fourth starts with the third).
   */
  panels: { rise: px.panelRise, duration: dur.base, ease: ease.settle, startAt: 0.85, step: delay.panelStep, groupMax: 3 },
  /** Card to project page (View Transitions): the cover moves, the rest cross-fades, callouts draw. */
  cardToPage: {
    cover: { duration: dur.page, ease: ease.move },
    crossFade: { duration: dur.page, ease: ease.fade },
    callouts: { duration: dur.short, ease: ease.settle },
    /**
     * Sheet 7.3: the longest the old page is held, frozen, while the new page renders and its cover
     * photo arrives (the browser shows the old page until the transition starts). After this the
     * transition runs with whatever has arrived, so a slow network never holds a click for long.
     * Not on the sheet: a cap, not a motion.
     */
    wait: 0.5,
  },
  /** Filtering projects: cards that stay move, cards that leave fade out, cards that arrive fade in after 100 ms. */
  filter: {
    move: { duration: dur.base, ease: ease.settle },
    leave: { duration: dur.quick, ease: ease.fade },
    arrive: { delay: 0.1, duration: dur.short, ease: ease.fade },
  },
  /**
   * The phone menu unrolls like a sheet with a 1 px line riding the roll's edge; its links drop
   * 8 px and fade in, 40 ms apart from 80 ms; Close rolls it back up, links with it.
   */
  menu: {
    open: { duration: dur.sheet, ease: ease.settle },
    close: { duration: dur.sheetBack, ease: ease.exit },
    edgeLine: 1,
    links: { drop: px.menuDrop, duration: dur.short, start: delay.menuStart, step: delay.menuStep, ease: ease.settle },
  },
  /** The theme cross-fade, through document.startViewTransition. */
  theme: { duration: dur.base, ease: ease.fade },
  /** Link underlines draw from the left. */
  underline: { duration: dur.quick, ease: ease.fade },
  /** Buttons: the press sinks 1 px, the hover fill fades in, the primary button's heat sweep grows (240 ms). */
  button: {
    press: { distance: px.press, duration: dur.press, ease: ease.settle },
    hover: { duration: dur.quick, ease: ease.fade },
    sweep: { duration: dur.sheetBack, ease: ease.settle },
  },
  /** The arrow in a text button, a readout or "Open project" moves 3 px to the right. */
  nudge: { distance: px.nudge, duration: dur.quick, ease: ease.fade },
  /** The fill under a readout fades in on hover. */
  readoutFill: { duration: dur.quick, ease: ease.fade },
  /**
   * The tools ticker slides left one full copy every 80 s and loops; it pauses on hover and focus.
   *
   * From the canvas's home.css: it moves from a 768 px frame (`minWidth`); a phone, with no hover
   * to pause it, keeps the row the thumb drags. Not on the sheet, all in window heights from the
   * view: `load`, how close the strip is when the moving ticker's code starts to load; `near` and
   * `far`, how close it is when the moving ticker is mounted and how far when it gives way to the
   * still row again. A mounted Motion+ Ticker asks for every frame, even at rest, so it is mounted
   * just before the strip comes into view (it measures itself within 100 px of the view) and taken
   * away soon after it leaves. `key`: the arrow keys move it one item with the snap spring, as the
   * gallery's arrow keys move it one frame (sheet 6.4).
   */
  ticker: { loop: 80, ease: ease.linear, minWidth: 768, load: 1, near: 0.25, far: 0.5, key: spring.snap },
  /**
   * The phone project strip (DESIGN_DIRECTION.md 6.4 and 7): under a 768 px frame (`maxWidth`)
   * the featured cards are a Motion+ Carousel that moves as the gallery does (sheet 6.4): after a
   * drag, Previous, Next or an arrow key it snaps with the snap spring, and dragged past either
   * end it stretches at a fifth of the pointer's travel. Not on the sheet: `load`, `near` and `far`
   * as for the ticker (a mounted Carousel asks for every frame too); `shown`, the share of a card in
   * view that makes it the one the marks under the scrolling strip light, before the carousel takes
   * over.
   */
  strip: { maxWidth: 767, snap: media.gallery.snap, overdrag: media.gallery.overdrag, load: 1, near: 0.25, far: 0.5, shown: 0.6 },
} as const;

// ---------------------------------------------------------------------------------------------
// Sheet 8: the admin's one motion
// ---------------------------------------------------------------------------------------------

/**
 * Sheet 8.3 and DESIGN_DIRECTION.md 6.4: the admin is a tool, and nothing in it moves except the
 * save bar's status text, which scrambles into its new words (Motion+ ScrambleText) and sets at
 * once under reduced motion (components/admin/shell/StatusText.tsx). The sheets give the scramble
 * no timing, so it takes the scale's: every character scrambles at once, and they settle left to
 * right, the first after `settleFirst` (dur.short, 200 ms) and the last after `settleLast`
 * (dur.line, 400 ms, as a headline line sets), so a line of any length reads whole within 400 ms.
 * `interval` is how often a scrambling character changes: ScrambleText's own 0.05 s.
 */
export const admin = {
  status: { settleFirst: dur.short, settleLast: dur.line, interval: 0.05 },
} as const;
