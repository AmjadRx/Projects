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

export const INITIAL_VIDEO_STATE: VideoState = {
  ready: false,
  playing: false,
  muted: false,
  captionsOn: false,
  duration: 0,
  started: false,
  waiting: false,
  failed: false,
};

export interface VideoEngineApi {
  togglePlay: () => void;
  seekBy: (seconds: number) => void;
  toggleMute: () => void;
  toggleCaptions: () => void;
  toggleFullscreen: () => void;
}

export interface VideoEngineProps {
  media: ResolvedMedia;
  /** Scroll position drives the playhead (fine pointer, motion allowed, not released). */
  scrubbing: boolean;
  /** The visitor pressed play before the engine had loaded: start once it has. */
  playOnReady: boolean;
  apiRef: MutableRefObject<VideoEngineApi | null>;
  timeRef: RefObject<HTMLSpanElement>;
  /** The seek bar (role="slider"): the engine sets its position and value, and handles it. */
  seekRef: RefObject<HTMLDivElement>;
  onState: (patch: Partial<VideoState>) => void;
}

/** Merges a patch into state, keeping the same object (and so no render) when nothing changed. */
export function mergeState<T extends object>(prev: T, patch: Partial<T>): T {
  for (const key of Object.keys(patch) as (keyof T)[]) {
    if (prev[key] !== patch[key]) return { ...prev, ...patch };
  }
  return prev;
}
