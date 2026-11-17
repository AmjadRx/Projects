/**
 * The contract between the model viewer's light shell (ModelViewer.tsx, in the page bundle) and
 * its engine (ModelEngine.tsx, loaded on demand with three.js). Types and two numbers only:
 * importing this file never pulls the engine into a page.
 */
import type { MutableRefObject } from 'react';
import type { ModelView } from '../types';

/** One press of a rotate button or arrow key turns the model this far (15 degrees). */
export const ROTATE_STEP = Math.PI / 12;
/** One press of a zoom button or key changes the camera distance by this factor. */
export const ZOOM_STEP = 1.25;

/** A named child of the model root: one entry in the parts list. */
export interface EnginePart {
  id: string;
  name: string;
}

/** Camera commands for the toolbar buttons and the keyboard. */
export interface EngineHandle {
  /** Orbits by these angles in radians: positive azimuth turns the model left, positive polar tilts it up. */
  rotate: (azimuth: number, polar: number) => void;
  /** Multiplies the camera distance: below 1 zooms in, above 1 zooms out. */
  zoom: (factor: number) => void;
  /** Returns to the starting three-quarter view. */
  reset: () => void;
}

export interface ModelEngineProps {
  /** The GLB or glTF address. */
  src: string;
  view: ModelView;
  /** Exploded-view amount from 0 (assembled) to 1. */
  explode: number;
  /** The part to highlight, by id. */
  highlight: string | null;
  /** Turn slowly until the visitor first touches the viewer. */
  autoTurn: boolean;
  /** False while the tab is hidden or the viewer is out of view: nothing renders then. */
  running: boolean;
  reducedMotion: boolean;
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
}
