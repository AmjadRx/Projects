/**
 * The contract between the audio player's shell (AudioPlayer, in the page's first load: the
 * frame, the plain progress bar, the toolbar) and its engine (AudioEngine, loaded with
 * next/dynamic only when the player nears the viewport: the <audio> element, the seek control,
 * and the waveform). The playhead never goes through React state: the engine writes it into the
 * time readout and the seek control directly.
 */
import type { MutableRefObject, RefObject } from 'react';
import type { ResolvedMedia } from '@/lib/media';

export interface AudioState {
  ready: boolean;
  playing: boolean;
  muted: boolean;
  /** Seconds; 0 until the metadata has loaded. */
  duration: number;
  failed: boolean;
}

export const INITIAL_AUDIO_STATE: AudioState = { ready: false, playing: false, muted: false, duration: 0, failed: false };

export interface AudioEngineApi {
  togglePlay: () => void;
  seekBy: (seconds: number) => void;
  toggleMute: () => void;
}

export interface AudioEngineProps {
  media: ResolvedMedia;
  /** The visitor pressed play before the engine had loaded: start once it has. */
  playOnReady: boolean;
  apiRef: MutableRefObject<AudioEngineApi | null>;
  timeRef: RefObject<HTMLSpanElement>;
  onState: (patch: Partial<AudioState>) => void;
}
