/**
 * The contract between the model viewers' light shells (ModelViewer.tsx and HeroModelViewer.tsx,
 * in the page bundle) and their engine (ModelEngine.tsx, loaded on demand with three.js). Types
 * and a few numbers only: importing this file never pulls the engine into a page.
 */
import type { MotionValue } from 'motion/react';
import type { MutableRefObject } from 'react';
import type { ModelView } from '../types';

/** One press of a rotate button or arrow key turns the model this far (15 degrees). */
export const ROTATE_STEP = Math.PI / 12;
/** One press of a zoom button or key changes the target zoom by this factor. */
export const ZOOM_STEP = 1.25;
/**
 * One wheel notch changes the target zoom by this factor: the step the viewer's OrbitControls
 * used before the zoom was eased (its zoom scale, 0.95, to the power of its zoom speed, 0.9).
 */
export const WHEEL_ZOOM_STEP = 0.95 ** 0.9;

/** A named child of the model root: one entry in the parts list. */
export interface EnginePart {
  id: string;
  name: string;
}

/** Camera commands for the toolbar buttons and the keyboard. */
export interface EngineHandle {
  /** Orbits by these angles in radians: positive azimuth turns the model left, positive polar tilts it up. */
  rotate: (azimuth: number, polar: number) => void;
  /** Multiplies the target camera distance: below 1 zooms in, above 1 zooms out. */
  zoom: (factor: number) => void;
  /** Returns to the starting three-quarter view. */
  reset: () => void;
}

/**
 * The hero lens (useHeroLens.ts): its centre and radius in CSS px of the stage, which the canvas
 * fills, and its opacity from 0 to 1. Motion values, so the lens moves without a React render.
 */
export interface HeroLensValues {
  x: MotionValue<number>;
  y: MotionValue<number>;
  radius: MotionValue<number>;
  opacity: MotionValue<number>;
}

/** What only the hero's model has (ARCHITECTURE.md 6, mode "model"; motion sheets 4.3 and 4.5). */
export interface HeroEngineInputs {
  /** The hero's scroll progress, 0 to 1 (useHeroScroll.ts): tilts RotorL and RotorR 0 to 90 degrees. */
  rotor: MotionValue<number>;
  lens: HeroLensValues;
  /**
   * The poster's width over height, when known: the first frame is fitted to match the poster
   * the stage showed before it (orbit.ts posterFitDistance).
   */
  posterAspect?: number;
}

export interface ModelEngineProps {
  /** The GLB or glTF address. */
  src: string;
  view: ModelView;
  /** Exploded-view amount from 0 (assembled) to 1: the slider sets it, the arrow keys ease it. */
  explode: MotionValue<number>;
  /** The part to highlight, by id. */
  highlight: string | null;
  /** Turn slowly until the visitor first touches the viewer. */
  autoTurn: boolean;
  /** False while the tab is hidden or the viewer is out of view: nothing renders then. */
  running: boolean;
  /**
   * Motion may play (useModelMotion.ts): the orbit glides, zoom and reset ease, views cross-fade,
   * and the hero goes back to its view, shows its lens, and tilts its rotors. When false, all of
   * that steps at once or stays off; the visitor's own drag still orbits.
   */
  motion: boolean;
  /** The frame is in full screen (ViewerFrame); the hero never is. */
  fullscreen: boolean;
  /** The id of the text description (the content's alt text), read when the canvas takes focus. */
  descriptionId?: string;
  callouts: { label: string; value: string }[];
  handleRef: MutableRefObject<EngineHandle | null>;
  /** Move focus to the canvas host once it exists (after a press of the load or resume button). */
  autoFocus?: boolean;
  /** The first frame with the model is on screen. */
  onReady: (parts: EnginePart[]) => void;
  /** The visitor touched the viewer (drag, wheel, key). */
  onInteract: () => void;
  /** The browser took the WebGL context away. */
  onContextLost: () => void;
  /** Set for the hero's model: no zoom, the lens, the rotor tilt, the return to its view. */
  hero?: HeroEngineInputs;
}
