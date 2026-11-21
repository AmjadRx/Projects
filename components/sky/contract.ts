/**
 * The contract between the sky's two halves, as the host relies on it (Phase 5).
 *
 * - The host, components/sky/Sky.tsx with components/sky/host.ts, is part of every first load and
 *   imports no three.js. It renders the layers, chooses the tier (lib/sky/tier.ts), loads the
 *   live scene after the page has loaded and gone idle, and feeds it the visitor's input.
 * - The live scene, components/sky/live/index.ts, is a chunk of its own and the only code that
 *   imports three.js. It draws into the host's .ar-sky__live layer.
 *
 * host.ts checks the imported scene against `LiveModule`, so a change on either side that breaks
 * the other fails `tsc`. The scene's renderStill (for the still images) is not used by the host.
 *
 * Changed after the first build (Phase 5 fixes), on both sides: `canRender` (asked before the data
 * loads), `LiveOptions.overlay` (the labels layer above the dawn), the pointer's `emptySky`, and the
 * theme passed to `loadSkyData`.
 */
import type { LiveTier } from '@/lib/sky/tier';
import type { Theme } from '@/lib/theme';

/** What the host passes to createSky. */
export interface LiveOptions {
  theme: Theme;
  tier: LiveTier;
  /** The clock time whose sidereal time the scene starts from: the still's step (stepTimeNear). */
  startTimeMs: number;
  /** Scroll progress, 0 to 1, read every frame. */
  getProgress: () => number;
  /** Called once the first frame is drawn; the host then fades the live layer in. */
  onReady: () => void;
  /** The frame rate, about every SKY.scene.fpsEvery seconds while the loop runs. */
  onFps: (fps: number) => void;
  /** The WebGL context was lost or a shader failed: the host goes to Still. */
  onError?: (reason: string) => void;
  /** The labels layer (.ar-sky__labels, above the dawn) where the drafting lines and names are drawn. */
  overlay?: HTMLElement;
}

/**
 * The pointer in CSS px. It moves the parallax wherever it is; `emptySky: false` (over text, a
 * panel or a control) draws no drafting lines for it.
 */
export interface LivePointer {
  x: number;
  y: number;
  emptySky?: boolean;
}

/** What the host calls on a running scene. */
export interface LiveController {
  /** The viewport in CSS px; the scene applies the pixel ratio cap of its tier. */
  setSize: (width: number, height: number) => void;
  /** Re-reads the colors after <html data-theme> changes. */
  setTheme: (theme: Theme) => void;
  /** Full to Light when the frame rate is too low. */
  setTier: (tier: LiveTier) => void;
  /** The pointer in CSS px, or null when it has left the window. */
  setPointer: (point: LivePointer | null) => void;
  /** A ripple across the ground from a click or tap on empty sky, in CSS px. */
  ripple: (x: number, y: number) => void;
  /** Runs the frame loop. */
  start: () => void;
  /** Stops the frame loop: no frames run until start(). */
  stop: () => void;
  /** Disposes every GPU resource and removes the scene's elements. */
  destroy: () => void;
}

/** The live scene's module. `Data` is whatever loadSkyData resolves to and createSky takes. */
export interface LiveModule<Data> {
  /**
   * True when the browser can draw the live sky (it makes the WebGL context the scene then
   * reuses). Asked before the data loads, so a machine without usable WebGL fetches none of it.
   */
  canRender: () => boolean;
  /**
   * Fetches the stars, their names and the Milky Way (4K on Full, 2K on Light). A Whiteprint page
   * (`theme`) gets no Milky Way, which it does not show; the scene fetches it if the page turns Blueprint.
   */
  loadSkyData: (tier: LiveTier, theme?: Theme) => Promise<Data>;
  createSky: (container: HTMLElement, data: Data, options: LiveOptions) => LiveController;
}
