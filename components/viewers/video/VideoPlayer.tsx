'use client';

import dynamic from 'next/dynamic';
import { Play } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { aspectOf, type ResolvedFile } from '@/lib/media';
import { UI } from '@/lib/strings';
import { failureText } from '../shared/DownloadLink';
import Poster from '../shared/Poster';
import TapToLoad from '../shared/TapToLoad';
import ViewerErrorBoundary from '../shared/ViewerErrorBoundary';
import ViewerFrame from '../shared/ViewerFrame';
import { useFinePointer, useReducedMotion } from '../shared/hooks';
import { useViewerActivation } from '../shared/useViewerActivation';
import type { VideoPlayerProps } from '../types';
import { INITIAL_VIDEO_STATE, mergeState, type VideoEngineApi, type VideoState } from './contract';
import EmbedPlayer from './EmbedPlayer';
import { SEEK_STEP } from './time';
import VideoControls from './VideoControls';
import styles from './VideoPlayer.module.css';

/** The engine (the <video> element and what drives it) never ships in a page's first load. */
const VideoEngine = dynamic(() => import('./VideoEngine'), { ssr: false });

/**
 * The video viewer (ARCHITECTURE.md 13A; DESIGN_DIRECTION.md 11): a file in the site's own
 * player, or a YouTube or Vimeo video behind a click-to-load poster.
 */
export default function VideoPlayer(props: VideoPlayerProps) {
  if (props.media.kind === 'embed') return <EmbedPlayer media={props.media} takeFocus={props.takeFocus} />;
  return <FilePlayer {...props} />;
}

function Failure({ file }: { file: ResolvedFile }) {
  return (
    <p className={styles.failure} role="status">
      {failureText(file)}
    </p>
  );
}

/** The error boundary's fallback: marks the player as failed, so the shell shows the message. */
function ReportFailure({ onFail }: { onFail: () => void }) {
  useEffect(() => onFail(), [onFail]);
  return null;
}

/**
 * A video file. The poster and the toolbar paint first, from the server; the engine loads when
 * the player nears the viewport (policy "view"), at once in the lightbox, or on a tap on a slow
 * connection. With `scrub`, a fine pointer, and motion allowed, scrolling moves the playhead
 * until the visitor presses play or opens full screen; then it is the normal player.
 *
 * Keyboard, anywhere in the player: Space or K play and pause (Space on a button presses that
 * button), the arrows seek 5 seconds, M mutes, C toggles captions, F toggles full screen. Keys
 * the player handles stop at the player, so a lightbox around it does not also act on them; the
 * lightbox's own buttons move between items.
 */
function FilePlayer({ media, scrub = false, inLightbox = false, takeFocus = false }: VideoPlayerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const playRef = useRef<HTMLButtonElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const seekRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<VideoEngineApi | null>(null);
  const { active, requiresTap, activate } = useViewerActivation(rootRef, 'view');
  const live = active || inLightbox;
  const [state, setState] = useState<VideoState>(INITIAL_VIDEO_STATE);
  const [playIntent, setPlayIntent] = useState(false);
  /** The visitor chose normal playback (play or full screen) over scroll scrubbing. */
  const [released, setReleased] = useState(false);
  const finePointer = useFinePointer();
  const reducedMotion = useReducedMotion();
  const scrubbing = scrub && finePointer && !reducedMotion && !released;
  const hasCaptions = Boolean(media.captionsSrc);
  const ready = state.ready && !state.failed;

  const onState = useCallback((patch: Partial<VideoState>) => setState((prev) => mergeState(prev, patch)), []);
  const onFail = useCallback(() => onState({ failed: true, playing: false, waiting: false }), [onState]);

  // A lightbox opened on this video gives the play button focus (after the dialog's own first focus).
  useEffect(() => {
    if (!takeFocus) return undefined;
    const frame = requestAnimationFrame(() => playRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [takeFocus]);

  const togglePlay = () => {
    if (state.failed) return;
    setReleased(true);
    const api = apiRef.current;
    if (api && state.ready) {
      api.togglePlay();
      return;
    }
    // Not loaded yet: load now and start as soon as the engine is in.
    setPlayIntent(true);
    activate();
  };

  const toggleFullscreen = () => {
    if (!ready) return;
    setReleased(true);
    apiRef.current?.toggleFullscreen();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target as HTMLElement;
    const onControl = target.closest('button, a') !== null;
    const api = apiRef.current;
    const take = () => {
      event.preventDefault();
      event.stopPropagation();
    };
    switch (event.key) {
      case ' ':
        // A button or link keeps its own Space; while scrubbing, Space scrolls (and so scrubs).
        if (onControl || scrubbing) return;
        take();
        togglePlay();
        return;
      case 'k':
      case 'K':
        take();
        togglePlay();
        return;
      case 'ArrowLeft':
      case 'ArrowRight':
        if (!api || !ready || scrubbing) return;
        take();
        api.seekBy(event.key === 'ArrowLeft' ? -SEEK_STEP : SEEK_STEP);
        return;
      case 'm':
      case 'M':
        if (!api || !ready || scrubbing) return;
        take();
        api.toggleMute();
        return;
      case 'c':
      case 'C':
        if (!api || !ready || !hasCaptions) return;
        take();
        api.toggleCaptions();
        return;
      case 'f':
      case 'F':
        if (!ready) return;
        take();
        toggleFullscreen();
        return;
      default:
    }
  };

  const loading = (playIntent && !state.ready) || state.waiting;
  const waitingForTap = requiresTap && !live;

  return (
    <div ref={rootRef} onKeyDown={onKeyDown}>
      <ViewerFrame
        label={UI.viewers.video.videoFallback}
        aspect={aspectOf(media, 16 / 9)}
        caption={media.caption}
        description={media.alt || undefined}
        download={media.file}
        allowFullscreen={false}
        toolbar={
          <VideoControls
            state={state}
            scrubbing={scrubbing}
            hasCaptions={hasCaptions}
            playRef={playRef}
            timeRef={timeRef}
            seekRef={seekRef}
            onPlay={togglePlay}
            onMute={() => apiRef.current?.toggleMute()}
            onCaptions={() => apiRef.current?.toggleCaptions()}
            onFullscreen={toggleFullscreen}
          />
        }
      >
        <div className={styles.stage}>
          {!state.started && (
            <div className={styles.poster}>
              {/* Without a poster, the bare grid while a button or status sits at the center. */}
              {media.poster || !(waitingForTap || loading) ? (
                <Poster media={media} />
              ) : (
                <div className="viewer-placeholder" aria-hidden="true" />
              )}
            </div>
          )}
          {live && (
            <ViewerErrorBoundary fallback={<ReportFailure onFail={onFail} />}>
              <VideoEngine
                media={media}
                scrubbing={scrubbing}
                playOnReady={playIntent}
                apiRef={apiRef}
                timeRef={timeRef}
                seekRef={seekRef}
                onState={onState}
              />
            </ViewerErrorBoundary>
          )}
          {/* Clicking the picture plays and pauses; the toolbar is the keyboard path. */}
          <div className={styles.hit} onClick={togglePlay} aria-hidden="true" />
          {loading && !state.failed ? (
            <span className={styles.status} aria-hidden="true">
              {UI.viewers.loading}
            </span>
          ) : (
            !state.started &&
            !state.failed &&
            !waitingForTap &&
            media.poster && (
              <span className={styles.badge} aria-hidden="true">
                <Play size={22} />
              </span>
            )
          )}
          <span className="sr-only" role="status">
            {loading && !state.failed ? UI.viewers.loading : ''}
          </span>
          {waitingForTap && (
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
          {state.failed && <Failure file={media.file} />}
        </div>
      </ViewerFrame>
    </div>
  );
}
