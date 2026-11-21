/**
 * The contract between the video player's shell (VideoPlayer, in the page's first load: the
 * poster, the controls, the frame) and its engine (VideoEngine, loaded with next/dynamic only
 * when the player nears the viewport: the <video> element and everything that drives it).
 *
 * The engine reports discrete changes through `onState`. The playhead never goes through React
 * state: the engine writes it straight into the time readout and the seek bar (its `--progress`
 * and its ARIA value), so playback and scroll scrubbing never re-render the player
 * (docs/V3_PLAN.md D-55).
 */
import type { MutableRefObject, RefObject } from 'react';
import type { ResolvedMedia } from '@/lib/media';

export interface VideoState {
  /** The engine has loaded and the controls work. */
  ready: boolean;
  playing: boolean;
  muted: boolean;
  captionsOn: boolean;
  /** Seconds; 0 until the metadata has loaded. */
  duration: number;
  /** The video has a frame to show (it played or seeked): the poster steps aside. */
  started: boolean;
  /** Playback waits for data. */
  waiting: boolean;
  /** The file could not load or play. */
  failed: boolean;
}

/**
 * Every video loads muted (motion sheet 6.1, Loading): sound starts only from a press of the
 * visitor's, Play or Unmute (the engine).
 */
export const INITIAL_VIDEO_STATE: VideoState = {
  ready: false,
  playing: false,
  muted: true,
  captionsOn: false,
  duration: 0,
  started: false,
  waiting: false,
  failed: false,
};

/**
 * The visitor's controls. Each one but captions also takes the player over: from then on it plays
 * only when the visitor says so (motion sheet 6.1).
 */
export interface VideoEngineApi {
  togglePlay: () => void;
  seekBy: (seconds: number) => void;
  toggleMute: () => void;
  toggleCaptions: () => void;
  toggleFullscreen: () => void;
}

/**
 * The scroll-scrubbed video's run (app/motion-media.css): the element that holds it all (the
 * scroll target), the stage that sticks under the nav, and the empty element after the stage whose
 * height is the run.
 */
export interface ScrubRun {
  run: RefObject<HTMLDivElement>;
  stage: RefObject<HTMLDivElement>;
  spacer: RefObject<HTMLDivElement>;
}

export interface VideoEngineProps {
  media: ResolvedMedia;
  /** Scroll position drives the playhead now: the run is in use and the visitor has not pressed play. */
  scrubbing: boolean;
  /** The `scrub` option's run, while the stylesheet keeps it (app/motion-media.css); else null. */
  scrubRun: ScrubRun | null;
  /**
   * May play by itself, muted, while in view (motion sheet 6.1): motion allowed and not paused, no
   * Save-Data or slow connection, not a scrubbed video, and a file that has not failed.
   */
  autoplay: boolean;
  /** The layer the player sits on: the page (0) or the lightbox over it (playback.ts). */
  layer: number;
  /** The visitor pressed play before the engine had loaded: start once it has. */
  playOnReady: boolean;
  apiRef: MutableRefObject<VideoEngineApi | null>;
  timeRef: RefObject<HTMLSpanElement>;
  /** The seek bar (role="slider"): the engine sets its position and value, and handles it. */
  seekRef: RefObject<HTMLDivElement>;
  onState: (patch: Partial<VideoState>) => void;
  /** The player has left the view entirely (a scrubbed video then follows the scroll again). */
  onLeaveView: () => void;
}

/** What decides how a video file's player behaves on its own (playerModes). */
export interface ModeInput {
  /** The block's scrub option. */
  scrub: boolean;
  inLightbox: boolean;
  /** A mouse or a pen: `(hover: hover) and (pointer: fine)`. */
  finePointer: boolean;
  /** useMotionOk(): no reduced motion, not in /admin. */
  motionOk: boolean;
  /** The visitor's "Pause motion" control is on. */
  paused: boolean;
  /** Save-Data or a slow connection. */
  slow: boolean;
  /** The file could not load or play. */
  failed: boolean;
  /** The visitor pressed play (or full screen) on a scrubbed video, until it leaves the view. */
  released: boolean;
}

export interface PlayerModes {
  /** The scrub option counts here: not in the lightbox, where every video is an ordinary player. */
  scrubbable: boolean;
  /** The run is kept, as app/motion-media.css keeps it: a fine pointer, motion allowed, not paused. */
  runInUse: boolean;
  /** Scroll drives the playhead now. */
  scrubbing: boolean;
  /** May play by itself, muted, while in view (VideoEngineProps.autoplay). */
  autoplay: boolean;
}

/**
 * How a video file's player behaves on its own (motion sheets 6.1 and 6.2). A scrubbed video keeps
 * its run where the stylesheet does and follows the scroll until the visitor presses play; any other
 * video may play by itself while in view, unless motion is off or paused, the connection is slow,
 * or its file failed (a broken player never holds the one-at-a-time slot).
 */
export function playerModes(input: ModeInput): PlayerModes {
  const scrubbable = input.scrub && !input.inLightbox;
  const runInUse = scrubbable && input.finePointer && input.motionOk && !input.paused;
  return {
    scrubbable,
    runInUse,
    scrubbing: runInUse && !input.slow && !input.failed && !input.released,
    autoplay: input.motionOk && !input.paused && !input.slow && !runInUse && !input.failed,
  };
}

/** Merges a patch into state, keeping the same object (and so no render) when nothing changed. */
export function mergeState<T extends object>(prev: T, patch: Partial<T>): T {
  for (const key of Object.keys(patch) as (keyof T)[]) {
    if (prev[key] !== patch[key]) return { ...prev, ...patch };
  }
  return prev;
}
