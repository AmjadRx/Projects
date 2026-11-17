'use client';

import dynamic from 'next/dynamic';
import { Pause, Play } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { UI } from '@/lib/strings';
import { cn } from '@/lib/utils';
import { failureText } from '../shared/DownloadLink';
import TapToLoad from '../shared/TapToLoad';
import ViewerErrorBoundary from '../shared/ViewerErrorBoundary';
import ViewerFrame from '../shared/ViewerFrame';
import { useViewerActivation } from '../shared/useViewerActivation';
import type { AudioPlayerProps } from '../types';
import { mergeState } from '../video/contract';
import { formatClock, SEEK_STEP } from '../video/time';
import { INITIAL_AUDIO_STATE, type AudioEngineApi, type AudioState } from './contract';
import styles from './AudioPlayer.module.css';

/** The engine (the <audio> element, the seek control, the waveform) never ships in a first load. */
const AudioEngine = dynamic(() => import('./AudioEngine'), { ssr: false });

/** The well: a wide strip, capped in height on wide screens. */
const AUDIO_ASPECT = 4;
const AUDIO_MAX_HEIGHT = '7.5rem';

/** The error boundary's fallback: marks the player as failed, so the shell shows the message. */
function ReportFailure({ onFail }: { onFail: () => void }) {
  useEffect(() => onFail(), [onFail]);
  return null;
}

/**
 * The audio viewer (ARCHITECTURE.md 13A; DESIGN_DIRECTION.md 11): a waveform player. The frame,
 * a plain progress bar, and the toolbar (play, the title or file name, the time) paint first;
 * the engine loads when the player nears the viewport (policy "view"), or on a tap on a slow
 * connection. The waveform is drawn from peaks stored with the media (computed once, at upload);
 * a file without them keeps the plain progress bar, and the file is never downloaded to draw one.
 * Keyboard, anywhere in the player: Space or K play and pause (Space on a button presses that
 * button), the arrows seek 5 seconds; on the waveform, Page Up, Page Down, Home, and End also work.
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
        if (!api || !state.ready || state.failed) return;
        event.preventDefault();
        api.seekBy(event.key === 'ArrowLeft' ? -SEEK_STEP : SEEK_STEP);
        return;
      default:
    }
  };

  const playLabel = state.playing ? UI.viewers.audio.pause : UI.viewers.audio.play;

  return (
    <div ref={rootRef} onKeyDown={onKeyDown}>
      <ViewerFrame
        label={label}
        aspect={AUDIO_ASPECT}
        maxWellHeight={AUDIO_MAX_HEIGHT}
        caption={media.caption}
        description={media.alt || undefined}
        download={media.file}
        allowFullscreen={false}
        toolbar={
          <div className={styles.controls}>
            <button
              ref={playRef}
              type="button"
              className="viewer-button"
              onClick={togglePlay}
              disabled={state.failed}
              aria-label={playLabel}
              title={playLabel}
            >
              {state.playing ? <Pause size={18} aria-hidden /> : <Play size={18} aria-hidden />}
            </button>
            <span className={styles.title}>{label}</span>
            <span className={cn('data', styles.time)}>
              <span ref={timeRef}>0:00</span>
              <span className={state.duration > 0 ? undefined : styles.pending}> / {formatClock(state.duration)}</span>
            </span>
          </div>
        }
      >
        <div className={styles.stage}>
          {/* The poster: a plain progress bar at the start, until the engine draws its own. */}
          {!state.ready && (
            <div className={styles.track} aria-hidden="true">
              <div className={styles.fill} />
            </div>
          )}
          {active && (
            <ViewerErrorBoundary fallback={<ReportFailure onFail={onFail} />}>
              <AudioEngine media={media} playOnReady={playIntent} apiRef={apiRef} timeRef={timeRef} onState={onState} />
            </ViewerErrorBoundary>
          )}
          {requiresTap && !active && (
            <div className={styles.layer}>
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
            <p className={styles.failure} role="status">
              {failureText(media.file)}
            </p>
          )}
        </div>
      </ViewerFrame>
    </div>
  );
}
