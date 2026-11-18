'use client';

import dynamic from 'next/dynamic';
import { Pause, Play, Volume2, VolumeX } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import Icon from '@/components/sheet/Icon';
import { UI } from '@/lib/strings';
import { cn } from '@/lib/utils';
import { failureText } from '../shared/DownloadLink';
import TapToLoad from '../shared/TapToLoad';
import ViewerErrorBoundary from '../shared/ViewerErrorBoundary';
import { captionLine } from '../shared/caption';
import ViewerFrame from '../shared/ViewerFrame';
import { useViewerActivation } from '../shared/useViewerActivation';
import type { AudioPlayerProps } from '../types';
import { mergeState } from '../video/contract';
import { formatClock, SEEK_STEP } from '../video/time';
import { INITIAL_AUDIO_STATE, type AudioEngineApi, type AudioState } from './contract';
import styles from './AudioPlayer.module.css';

/** The engine (the <audio> element, the seek control, the waveform) never ships in a first load. */
const AudioEngine = dynamic(() => import('./AudioEngine'), { ssr: false });

/** The well (bundle AudioPlayer): a 16:4 strip. */
const AUDIO_ASPECT = 4;

/** The error boundary's fallback: marks the player as failed, so the shell shows the message. */
function ReportFailure({ onFail }: { onFail: () => void }) {
  useEffect(() => onFail(), [onFail]);
  return null;
}

/**
 * The audio viewer (bundle AudioPlayer; ARCHITECTURE.md 13A): a waveform player in a 16:4 well.
 * Play and pause sit on a night plate at the well's left, the waveform runs to its right; the bar
 * holds the time and mute; the caption line names the title (or the caption, or the file). The
 * frame, a plain progress line, and the controls paint first; the engine loads when the player
 * nears the viewport (policy "view"), or on a tap on a slow connection. The waveform is drawn from
 * peaks stored with the media (computed once, at upload); a file without them keeps the plain
 * line, and the file is never downloaded to draw one.
 *
 * Keyboard, anywhere in the player: Space or K play and pause (Space on a button presses that
 * button), the arrows seek 5 seconds, M mutes; on the waveform, Page Up, Page Down, Home, and End
 * also work.
 */
export default function AudioPlayer({ media, title }: AudioPlayerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const playRef = useRef<HTMLButtonElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const apiRef = useRef<AudioEngineApi | null>(null);
  const { active, requiresTap, activate } = useViewerActivation(rootRef, 'view');
  const [state, setState] = useState<AudioState>(INITIAL_AUDIO_STATE);
  const [playIntent, setPlayIntent] = useState(false);
  const label = title?.trim() || media.file.name;
  const ready = state.ready && !state.failed;

  const onState = useCallback((patch: Partial<AudioState>) => setState((prev) => mergeState(prev, patch)), []);
  const onFail = useCallback(() => onState({ failed: true, playing: false }), [onState]);

  const togglePlay = () => {
    if (state.failed) return;
    const api = apiRef.current;
    if (api && state.ready) {
      api.togglePlay();
      return;
    }
    // Not loaded yet: load now and start as soon as the engine is in.
    setPlayIntent(true);
    activate();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const onControl = (event.target as HTMLElement).closest('button, a') !== null;
    const api = apiRef.current;
    switch (event.key) {
      case ' ':
        if (onControl) return;
        event.preventDefault();
        togglePlay();
        return;
      case 'k':
      case 'K':
        event.preventDefault();
        togglePlay();
        return;
      case 'ArrowLeft':
      case 'ArrowRight':
        if (!api || !ready) return;
        event.preventDefault();
        api.seekBy(event.key === 'ArrowLeft' ? -SEEK_STEP : SEEK_STEP);
        return;
      case 'm':
      case 'M':
        if (!api || !ready) return;
        event.preventDefault();
        api.toggleMute();
        return;
      default:
    }
  };

  const playLabel = state.playing ? UI.viewers.audio.pause : UI.viewers.audio.play;
  const muteLabel = state.muted ? UI.viewers.audio.unmute : UI.viewers.audio.mute;

  return (
    <div ref={rootRef} onKeyDown={onKeyDown}>
      <ViewerFrame
        label={label}
        kind={UI.viewers.kind.audio}
        aspect={AUDIO_ASPECT}
        caption={captionLine(title, media.caption)}
        fileName={media.file.name}
        description={media.alt || undefined}
        downloads={[{ file: media.file }]}
        allowFullscreen={false}
        toolbar={
          <div className={styles.controls}>
            <span className="ar-mv__time">
              <span ref={timeRef}>0:00</span>
              <span className={state.duration > 0 ? undefined : styles.pending}> / {formatClock(state.duration)}</span>
            </span>
            <button
              type="button"
              className="ar-mv__btn"
              onClick={() => apiRef.current?.toggleMute()}
              disabled={!ready}
              aria-label={muteLabel}
              title={muteLabel}
            >
              <Icon icon={state.muted ? VolumeX : Volume2} size={18} />
            </button>
          </div>
        }
      >
        <div className={styles.stage}>
          {/* The poster: a plain progress line, until the engine draws its own. */}
          {!state.ready && (
            <div className={styles.area} aria-hidden="true">
              <div className={styles.track}>
                <div className={styles.fill} />
              </div>
            </div>
          )}
          {active && (
            <ViewerErrorBoundary fallback={<ReportFailure onFail={onFail} />}>
              <AudioEngine media={media} playOnReady={playIntent} apiRef={apiRef} timeRef={timeRef} onState={onState} />
            </ViewerErrorBoundary>
          )}
          <span className="ar-mv__play ar-mv__play--left">
            <button
              ref={playRef}
              type="button"
              className="ar-mv__btn"
              onClick={togglePlay}
              disabled={state.failed}
              aria-label={playLabel}
              title={playLabel}
            >
              <Icon icon={state.playing ? Pause : Play} size={20} />
            </button>
          </span>
          {requiresTap && !active && (
            <div className={cn(styles.area, styles.layer)}>
              <TapToLoad
                label={UI.viewers.loadViewer}
                onActivate={() => {
                  // The button goes once the engine loads; focus stays in the player, on play.
                  playRef.current?.focus({ preventScroll: true });
                  activate();
                }}
              />
            </div>
          )}
          {state.failed && (
            <p className="ar-mv__note" role="status">
              {failureText(media.file)}
            </p>
          )}
        </div>
      </ViewerFrame>
    </div>
  );
}
