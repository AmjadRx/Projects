'use client';

import { Captions, Maximize2, Minimize2, Pause, Play, Volume2, VolumeX } from 'lucide-react';
import type { RefObject } from 'react';
import Icon from '@/components/sheet/Icon';
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
}

/**
 * The video player's bar (bundle VideoPlayer): play and pause, the scrub bar (an ink-mute track,
 * the line color for what has played, an ink handle), the time, mute, and captions. It renders on
 * the server with the poster, so the bar never shifts when the engine loads; until then every
 * control but play is drawn in phantom line, and play loads the engine and starts. Full screen
 * sits in the well's corner (FullscreenCorner).
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
}: VideoControlsProps) {
  const labels = UI.viewers.video;
  const ready = state.ready && !state.failed;
  const seekable = ready && state.duration > 0;
  const playLabel = state.playing ? labels.pause : labels.play;
  const muteLabel = state.muted ? labels.unmute : labels.mute;
  const captionsLabel = state.captionsOn ? labels.captionsOff : labels.captionsOn;

  return (
    <div className={styles.controls}>
      <button
        ref={playRef}
        type="button"
        className="ar-mv__btn"
        onClick={onPlay}
        disabled={state.failed}
        aria-label={playLabel}
        title={playLabel}
      >
        <Icon icon={state.playing ? Pause : Play} size={18} />
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
      <p className={cn('ar-mv__hint', styles.hint)} hidden={!scrubbing}>
        {labels.scrubHint}
      </p>
      <span className={cn('ar-mv__time', styles.time)}>
        <span ref={timeRef}>0:00</span>
        <span className={state.duration > 0 ? undefined : styles.pending}> / {formatClock(state.duration)}</span>
      </span>
      <span className={styles.grow} aria-hidden="true" />
      {!scrubbing && (
        <button
          type="button"
          className="ar-mv__btn"
          onClick={onMute}
          disabled={!ready}
          aria-label={muteLabel}
          title={muteLabel}
        >
          <Icon icon={state.muted ? VolumeX : Volume2} size={18} />
        </button>
      )}
      {hasCaptions && (
        <button
          type="button"
          className={cn('ar-mv__btn', state.captionsOn && ready && styles.on)}
          onClick={onCaptions}
          disabled={!ready}
          aria-label={captionsLabel}
          title={captionsLabel}
        >
          <Icon icon={Captions} size={18} />
        </button>
      )}
    </div>
  );
}

/**
 * Full screen in the well's top right corner (bundle MediaFrame). The video's engine decides how
 * (the frame, or the phone's own player), so it waits for the engine.
 */
export function FullscreenCorner({ ready, onToggle }: { ready: boolean; onToggle: () => void }) {
  const { isFullscreen } = useViewerFrame();
  const label = isFullscreen ? UI.viewers.exitFullscreen : UI.viewers.fullscreen;
  return (
    <button type="button" className="ar-mv__btn" onClick={onToggle} disabled={!ready} aria-label={label} title={label}>
      <Icon icon={isFullscreen ? Minimize2 : Maximize2} size={18} />
    </button>
  );
}
