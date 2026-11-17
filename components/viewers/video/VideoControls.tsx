'use client';

import { Captions, Maximize2, Minimize2, Pause, Play, Volume2, VolumeX } from 'lucide-react';
import type { RefObject } from 'react';
import { UI } from '@/lib/strings';
import { cn } from '@/lib/utils';
import { useViewerFrame } from '../shared/ViewerFrame';
import type { VideoState } from './contract';
import { formatClock } from './time';
import styles from './VideoPlayer.module.css';

interface VideoControlsProps {
  state: VideoState;
  /** Scroll drives the playhead: the seek bar gives way to the hint, and mute is not offered. */
  scrubbing: boolean;
  hasCaptions: boolean;
  playRef: RefObject<HTMLButtonElement>;
  timeRef: RefObject<HTMLSpanElement>;
  seekRef: RefObject<HTMLDivElement>;
  onPlay: () => void;
  onMute: () => void;
  onCaptions: () => void;
  onFullscreen: () => void;
}

/**
 * The video player's toolbar: play and pause, the seek bar, the time, mute, captions, and full
 * screen. It renders on the server with the poster, so the row never shifts when the engine
 * loads; until then every control but play is disabled, and play loads the engine and starts.
 *
 * The seek bar is a role="slider" element rather than a range input, because a range input
 * jumps to wherever a finger lands, and a finger that only scrolls past would seek. The engine
 * attaches its gestures and keys (components/viewers/video/seek.ts) and writes its position
 * (`--progress`) and its value (`aria-valuenow`, `aria-valuetext`) directly, as it writes the
 * time readout: React renders those once and never again.
 */
export default function VideoControls({
  state,
  scrubbing,
  hasCaptions,
  playRef,
  timeRef,
  seekRef,
  onPlay,
  onMute,
  onCaptions,
  onFullscreen,
}: VideoControlsProps) {
  const { isFullscreen } = useViewerFrame();
  const labels = UI.viewers.video;
  const ready = state.ready && !state.failed;
  const seekable = ready && state.duration > 0;
  const playLabel = state.playing ? labels.pause : labels.play;
  const muteLabel = state.muted ? labels.unmute : labels.mute;
  const captionsLabel = state.captionsOn ? labels.captionsOff : labels.captionsOn;
  const fullscreenLabel = isFullscreen ? UI.viewers.exitFullscreen : UI.viewers.fullscreen;

  return (
    <div className={styles.controls}>
      <button
        ref={playRef}
        type="button"
        className="viewer-button"
        onClick={onPlay}
        disabled={state.failed}
        aria-label={playLabel}
        title={playLabel}
      >
        {state.playing ? <Pause size={18} aria-hidden /> : <Play size={18} aria-hidden />}
      </button>
      <div
        ref={seekRef}
        className={styles.seek}
        role="slider"
        tabIndex={seekable ? 0 : -1}
        hidden={scrubbing}
        aria-label={labels.seek}
        aria-valuemin={0}
        aria-valuemax={Math.floor(state.duration)}
        aria-valuenow={0}
        aria-disabled={seekable ? undefined : true}
      >
        <span className={styles.seekTrack} aria-hidden="true">
          <span className={styles.seekFill} />
          <span className={styles.seekThumb} />
        </span>
      </div>
      <p className={styles.hint} hidden={!scrubbing}>
        {labels.scrubHint}
      </p>
      <span className={cn('data', styles.time)}>
        <span ref={timeRef}>0:00</span>
        <span className={state.duration > 0 ? undefined : styles.pending}> / {formatClock(state.duration)}</span>
      </span>
      <span className={styles.grow} aria-hidden="true" />
      {!scrubbing && (
        <button
          type="button"
          className="viewer-button"
          onClick={onMute}
          disabled={!ready}
          aria-label={muteLabel}
          title={muteLabel}
        >
          {state.muted ? <VolumeX size={18} aria-hidden /> : <Volume2 size={18} aria-hidden />}
        </button>
      )}
      {hasCaptions && (
        <button
          type="button"
          className={cn('viewer-button', state.captionsOn && styles.on)}
          onClick={onCaptions}
          disabled={!ready}
          aria-label={captionsLabel}
          title={captionsLabel}
        >
          <Captions size={18} aria-hidden />
        </button>
      )}
      <button
        type="button"
        className="viewer-button"
        onClick={onFullscreen}
        disabled={!ready}
        aria-label={fullscreenLabel}
        title={fullscreenLabel}
      >
        {isFullscreen ? <Minimize2 size={18} aria-hidden /> : <Maximize2 size={18} aria-hidden />}
      </button>
    </div>
  );
}
