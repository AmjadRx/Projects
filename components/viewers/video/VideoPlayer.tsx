'use client';

import dynamic from 'next/dynamic';
import { Play } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import Icon from '@/components/sheet/Icon';
import { aspectOf, type ResolvedFile } from '@/lib/media';
import { cssEasing, media as mediaMotion, toMs } from '@/lib/motion';
import { useMotionPaused } from '@/lib/motionPause';
import { UI } from '@/lib/strings';
import { useMotionOk } from '@/lib/useMotionOk';
import { cn } from '@/lib/utils';
import { failureText } from '../shared/DownloadLink';
import Poster from '../shared/Poster';
import TapToLoad from '../shared/TapToLoad';
import ViewerErrorBoundary from '../shared/ViewerErrorBoundary';
import ViewerFrame from '../shared/ViewerFrame';
import { useFinePointer } from '../shared/hooks';
import { useViewerActivation } from '../shared/useViewerActivation';
import type { VideoPlayerProps } from '../types';
import {
  INITIAL_VIDEO_STATE,
  mergeState,
  playerModes,
  type ScrubRun,
  type VideoEngineApi,
  type VideoState,
} from './contract';
import EmbedPlayer from './EmbedPlayer';
import { LIGHTBOX_LAYER } from './playback';
import { SEEK_STEP } from './time';
import { useScrubRun, useSlowConnection } from './useScrubRun';
import VideoControls, { FullscreenCorner } from './VideoControls';
import styles from './VideoPlayer.module.css';

/** The engine (the <video> element and what drives it) never ships in a page's first load. */
const VideoEngine = dynamic(() => import('./VideoEngine'), { ssr: false });

/** The poster giving way to its video (motion sheet 6.1), for app/motion-media.css. */
const MOTION_STYLE = {
  '--mm-poster-out': `${toMs(mediaMotion.video.posterOut)}ms`,
  '--mm-poster-ease': cssEasing(mediaMotion.video.posterEase),
} as CSSProperties;

/**
 * The video viewer (ARCHITECTURE.md 13A; DESIGN_DIRECTION.md 11): a file in the site's own
 * player, or a YouTube or Vimeo video behind a click-to-load poster.
 */
export default function VideoPlayer(props: VideoPlayerProps) {
  if (props.media.kind === 'embed') {
    return (
      <EmbedPlayer media={props.media} takeFocus={props.takeFocus} layer={props.inLightbox ? LIGHTBOX_LAYER : 0} />
    );
  }
  return <FilePlayer {...props} />;
}

function Failure({ file }: { file: ResolvedFile }) {
  return (
    <p className="ar-mv__note" role="status">
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
 * the player comes within 200 px of the view (policy "view"), at once in the lightbox, or on a
 * tap on a slow connection.
 *
 * Motion (motion sheet 6; DESIGN_DIRECTION.md 6.3). The video plays by itself, muted, while it is
 * the one most in view of those at least 0.6 in view (components/viewers/video/playback.ts), and
 * its poster gives way in 150 ms once the first frame is ready. Nothing plays by itself under
 * reduced motion, while motion is paused, on a slow connection, or once its file has failed: the
 * poster and the play button stay (contract.ts, playerModes). With `scrub`, on a fine pointer with
 * motion allowed, the player sticks under the nav while the page scrolls through a run, and the
 * scroll moves the playhead (the engine's ScrubDriver); a clip too tall for the room under the nav
 * is contained in a shorter well, so the whole block stays in view (app/motion-media.css). Pressing
 * play hands it back to normal playback until it leaves the view. Anywhere else a scrubbed video
 * is an ordinary player.
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
  const runRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLSpanElement>(null);
  const apiRef = useRef<VideoEngineApi | null>(null);
  const { active, requiresTap, activate } = useViewerActivation(rootRef, 'view');
  const live = active || inLightbox;
  const [state, setState] = useState<VideoState>(INITIAL_VIDEO_STATE);
  const [playIntent, setPlayIntent] = useState(false);
  /** The visitor chose normal playback (play or full screen) over scroll scrubbing, until the player leaves the view. */
  const [released, setReleased] = useState(false);
  const motionOk = useMotionOk();
  const paused = useMotionPaused();
  const finePointer = useFinePointer();
  const slow = useSlowConnection();
  const hasCaptions = Boolean(media.captionsSrc);
  const ready = state.ready && !state.failed;

  const { scrubbable, runInUse, scrubbing, autoplay } = playerModes({
    scrub,
    inLightbox,
    finePointer,
    motionOk,
    paused,
    slow,
    failed: state.failed,
    released,
  });
  const run = useScrubRun(spacerRef, endRef, { active: runInUse, duration: state.duration, cancel: slow || state.failed });
  const scrubRun = useRef<ScrubRun>({ run: runRef, stage: stageRef, spacer: spacerRef }).current;

  const onState = useCallback((patch: Partial<VideoState>) => setState((prev) => mergeState(prev, patch)), []);
  const onFail = useCallback(() => onState({ failed: true, playing: false, waiting: false }), [onState]);
  const onLeaveView = useCallback(() => setReleased(false), []);

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

  const player = (
    <div ref={rootRef} onKeyDown={onKeyDown} className={motionOk ? 'mm-motion' : undefined} style={MOTION_STYLE}>
      <ViewerFrame
        label={UI.viewers.video.videoFallback}
        kind={UI.viewers.kind.video}
        aspect={aspectOf(media, 16 / 9)}
        caption={media.caption}
        fileName={media.file.name}
        description={media.alt || undefined}
        downloads={[{ file: media.file }]}
        allowFullscreen={false}
        corner={ready ? <FullscreenCorner ready={ready} onToggle={toggleFullscreen} /> : undefined}
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
          />
        }
      >
        <div className={styles.stage}>
          {/* The poster gives way once the video has a frame to show (app/motion-media.css). */}
          <div className={cn(styles.poster, 'mm-poster')} data-out={state.started ? '' : undefined}>
            {/* Without a poster, the bare grid while a button or status sits at the center. */}
            {media.poster || !(waitingForTap || loading) ? <Poster media={media} /> : null}
          </div>
          {live && (
            <ViewerErrorBoundary fallback={<ReportFailure onFail={onFail} />}>
              <VideoEngine
                media={media}
                scrubbing={scrubbing}
                scrubRun={runInUse ? scrubRun : null}
                autoplay={autoplay}
                layer={inLightbox ? LIGHTBOX_LAYER : 0}
                playOnReady={playIntent}
                apiRef={apiRef}
                timeRef={timeRef}
                seekRef={seekRef}
                onState={onState}
                onLeaveView={onLeaveView}
              />
            </ViewerErrorBoundary>
          )}
          {/* Clicking the picture plays and pauses; the toolbar is the keyboard path. */}
          <div className={styles.hit} onClick={togglePlay} aria-hidden="true" />
          {loading && !state.failed ? (
            <span className="ar-mv__note" aria-hidden="true">
              {UI.viewers.loading}
            </span>
          ) : (
            !state.started &&
            !state.failed &&
            !waitingForTap &&
            media.poster && (
              // The bundle's 56 px play plate over the poster; the bar's Play is the control.
              <span className="ar-mv__play ar-mv__play--mark" aria-hidden="true">
                <span className="ar-mv__btn">
                  <Icon icon={Play} size={22} />
                </span>
              </span>
            )
          )}
          <span className="ar-sr" role="status">
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

  if (!scrubbable) return player;
  // The scroll-scrubbed video's run (app/motion-media.css): the stage sticks under the nav while
  // the page scrolls past the spacer after it, whose height is the run; `end` marks where it ends.
  const runStyle = run === null ? undefined : ({ '--scrub-run': `${run}px` } as CSSProperties);
  return (
    <div ref={runRef} className="mm-scrub" style={runStyle}>
      <div ref={stageRef} className="mm-scrub__stage">
        {player}
      </div>
      <div ref={spacerRef} className="mm-scrub__run" aria-hidden="true" />
      <span ref={endRef} className="mm-scrub__end" aria-hidden="true" />
    </div>
  );
}
