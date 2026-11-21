'use client';

import { useMotionValueEvent, useScroll, useSpring, useTransform } from 'motion/react';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { isRemoteUrl } from '@/lib/media';
import { media as mediaMotion, rules } from '@/lib/motion';
import { UI } from '@/lib/strings';
import { useViewerFrame } from '../shared/ViewerFrame';
import { useDocumentVisible } from '../shared/hooks';
import type { ScrubRun, VideoEngineProps } from './contract';
import {
  PlaybackLedger,
  holdPlayback,
  joinAutoplay,
  registerPlayer,
  releasePlayback,
  shareThresholds,
  viewShare,
  type AutoplayHandle,
} from './playback';
import { scrubOffset, scrubTime } from './scrub';
import { attachSeekGestures, seekTargetForKey, writeSliderValue } from './seek';
import { clamp, durationOf, formatClock, seekValueText } from './time';
import styles from './VideoPlayer.module.css';

/** iPhone Safari has no element full screen, only the video's own (docs/V3_PLAN.md D-63). */
type WebkitVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void };

/** Who started the playback under way: the autoplay rule, or the visitor. */
type Starter = 'auto' | 'visitor';

/** The share of the video in view, observed in tenths and at 0.6 exactly (playback.ts). */
const SHARE_THRESHOLDS = shareThresholds(mediaMotion.video.shareStep, mediaMotion.video.inView);

/** The scrub spring (motion sheet 1.4); its first reading, the scroll position at load, is taken as it is. */
const SCRUB_SPRING = { ...mediaMotion.scrub.spring, skipInitialAnimation: true };

/** A seek to within one frame of where the video already is changes nothing that shows. */
const FRAME = 1 / rules.fps;

/**
 * The engine of the video player, loaded with next/dynamic only when the player nears the
 * viewport (ARCHITECTURE.md 13A): the <video> element with preload="metadata", playsInline and
 * muted, its events, the seek bar, captions, full screen, scroll scrubbing, and pausing when the
 * tab is hidden (docs/V3_PLAN.md D-66).
 *
 * Playback (motion sheet 6.1, components/viewers/video/playback.ts). While `autoplay` allows, the
 * video plays by itself, muted, when it is the one most in view of those at least 0.6 in view, and
 * pauses when it drops below. Any control the visitor uses (play or pause, the seek bar, mute, full
 * screen) takes the player over: from then on it plays only when the visitor says so, and while it
 * plays every other player waits. Whoever started it, it pauses when it leaves the view entirely
 * and when the tab is hidden.
 *
 * Sound only ever starts from the visitor's press. Every video loads muted. The visitor's first
 * press of Play gives sound, unless the video has already played by itself (it then stays muted
 * until Unmute) or the visitor has used the mute control; later presses leave the sound as it is.
 */
export default function VideoEngine({
  media,
  scrubbing,
  scrubRun,
  autoplay,
  layer,
  playOnReady,
  apiRef,
  timeRef,
  seekRef,
  onState,
  onLeaveView,
}: VideoEngineProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const frame = useViewerFrame();
  const frameLatest = useRef(frame);
  frameLatest.current = frame;
  const playOnReadyRef = useRef(playOnReady);
  const visible = useDocumentVisible();
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const onLeaveRef = useRef(onLeaveView);
  onLeaveRef.current = onLeaveView;
  const id = useId();
  /** While the visitor drags the seek bar: the asked-for time, which the bar follows. */
  const dragTimeRef = useRef<number | null>(null);
  /** True once a seek was asked for: the poster steps aside when that frame is decoded. */
  const seekedRef = useRef(false);
  /** 'auto' while the player may play by itself; 'visitor' once the visitor has taken it over. */
  const modeRef = useRef<'auto' | 'visitor'>('auto');
  /** Who started the playback under way, as of the last call (events arrive later). */
  const startedByRef = useRef<Starter | null>(null);
  /** Which play and pause events the page caused, and which the visitor did (playback.ts). */
  const [ledger] = useState(() => new PlaybackLedger());
  const handleRef = useRef<AutoplayHandle | null>(null);
  /** The share of the video in view at the last observation. */
  const shareRef = useRef(0);
  /** The browser refused to start the muted video by itself (a phone saving power): Play stays. */
  const [refused, setRefused] = useState(false);
  /**
   * The visitor's next press of Play gives sound: until the video first plays (by itself, or by the
   * visitor's own start) or the visitor uses the mute control.
   */
  const soundOnPlayRef = useRef(true);

  /** Pauses for a reason of the page's own. */
  const pauseQuietly = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.paused) return;
    ledger.askedPause();
    startedByRef.current = null;
    video.pause();
  }, [ledger]);

  const start = useCallback(
    (by: Starter) => {
      const video = videoRef.current;
      if (!video) return;
      if (by === 'auto' && video.paused) ledger.autoStart();
      startedByRef.current = by;
      const attempt = (withSound: boolean) => {
        video.play()?.catch((error: unknown) => {
          const name = error instanceof DOMException ? error.name : '';
          // Refused outright (no event was queued): a browser that will not start without a fresh
          // tap, or a file it cannot play. The play button stays for the visitor.
          if (by === 'auto' && (name === 'NotAllowedError' || name === 'NotSupportedError')) ledger.autoStartRefused();
          if (by === 'auto' && name === 'NotAllowedError') setRefused(true);
          // Sound refused: the press came before the engine had loaded, too long ago for a browser
          // that starts sound only straight from a press. It starts muted instead; Unmute gives sound.
          if (by === 'visitor' && name === 'NotAllowedError' && withSound && !video.muted) {
            video.muted = true;
            attempt(false);
            return;
          }
          if (!video.paused) return;
          if (startedByRef.current === by) startedByRef.current = null;
          onState({ playing: false, waiting: false });
        });
      };
      attempt(!video.muted);
    },
    [ledger, onState],
  );

  /**
   * The visitor has taken the player over: it no longer plays by itself, and a playback the
   * autoplay rule started becomes the visitor's (every other player waits while it plays).
   */
  const takeOver = useCallback(() => {
    if (modeRef.current === 'visitor') return;
    modeRef.current = 'visitor';
    handleRef.current?.leave();
    handleRef.current = null;
    const video = videoRef.current;
    if (video && !video.paused && startedByRef.current === 'auto') {
      startedByRef.current = 'visitor';
      holdPlayback(id, 'pause');
    }
  }, [id]);

  useLayoutEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;

    const seek = seekRef.current;

    /** Before the visitor's start: the first press of Play gives sound (see soundOnPlayRef). */
    const giveSound = () => {
      if (soundOnPlayRef.current) video.muted = false;
      soundOnPlayRef.current = false;
    };

    /**
     * Writes the playhead into the readout and the seek bar. No React render. The bar moves
     * every time; its value for assistive technology changes once a second at most.
     */
    const paint = () => {
      const duration = durationOf(video);
      const current = clamp(dragTimeRef.current ?? (video.currentTime || 0), 0, duration || Infinity);
      const time = timeRef.current;
      const clock = formatClock(current);
      if (time && time.textContent !== clock) time.textContent = clock;
      if (!seek) return;
      seek.style.setProperty('--progress', `${duration > 0 ? clamp(current / duration, 0, 1) * 100 : 0}%`);
      writeSliderValue(seek, current, seekValueText(current, duration));
    };

    // While playing, the bar moves every frame.
    let frameId = 0;
    const tick = () => {
      frameId = 0;
      if (video.paused || video.ended) return;
      paint();
      frameId = requestAnimationFrame(tick);
    };
    const startLoop = () => {
      if (!frameId) frameId = requestAnimationFrame(tick);
    };
    const stopLoop = () => {
      if (frameId) cancelAnimationFrame(frameId);
      frameId = 0;
    };

    const seekTo = (target: number) => {
      const duration = durationOf(video);
      if (!duration || !Number.isFinite(target)) return;
      seekedRef.current = true;
      video.currentTime = clamp(target, 0, duration);
      paint();
    };

    const reveal = () => {
      if (video.readyState >= 2) onState({ started: true });
    };

    const stopped = () => {
      startedByRef.current = null;
      releasePlayback(id);
      stopLoop();
      onState({ playing: false, waiting: false });
      paint();
    };

    const listeners: [string, () => void][] = [
      [
        'play',
        () => {
          // From the first playback on, whoever started it, Play leaves the sound as it is.
          soundOnPlayRef.current = false;
          if (!ledger.onPlay()) {
            // The visitor's start: the controls (the player is theirs already) or a phone's own player.
            takeOver();
            startedByRef.current = 'visitor';
            holdPlayback(id, 'pause');
          }
          onState({ playing: true });
          startLoop();
        },
      ],
      [
        'pause',
        () => {
          // A pause the page did not ask for is the visitor's (a phone's own player); the end of the file is not.
          if (!ledger.onPause() && !video.ended) {
            takeOver();
            startedByRef.current = null;
          }
          // Started again since: that start's own events report it.
          if (!video.paused) return;
          stopped();
        },
      ],
      ['ended', stopped],
      ['playing', () => onState({ started: true, waiting: false })],
      ['waiting', () => onState({ waiting: true })],
      ['canplay', () => onState({ waiting: false })],
      ['timeupdate', paint],
      [
        'seeked',
        () => {
          paint();
          if (seekedRef.current) reveal();
        },
      ],
      [
        'loadeddata',
        () => {
          if (seekedRef.current) reveal();
        },
      ],
      [
        'durationchange',
        () => {
          onState({ duration: durationOf(video) });
          paint();
        },
      ],
      [
        'loadedmetadata',
        () => {
          onState({ duration: durationOf(video) });
          paint();
        },
      ],
      ['volumechange', () => onState({ muted: video.muted })],
      [
        'error',
        () => {
          stopLoop();
          onState({ failed: true, playing: false, waiting: false });
        },
      ],
    ];
    for (const [type, handler] of listeners) video.addEventListener(type, handler);

    // A full-screen player on a phone can switch captions itself; keep the button in step.
    const tracks = video.textTracks;
    const onTracks = () => onState({ captionsOn: Array.from(tracks).some((track) => track.mode === 'showing') });
    tracks.addEventListener('change', onTracks);

    // The seek bar: press, drag, or tap to seek (seek.ts); the arrows move 5 seconds, the Page
    // keys a tenth, Home and End go to the ends. Handled keys stop here, so a lightbox around
    // the player does not also move to another item.
    let dragging = false;
    const detachGestures = seek
      ? attachSeekGestures(seek, {
          area: () => seek.firstElementChild?.getBoundingClientRect() ?? null,
          seek: (ratio) => {
            const duration = durationOf(video);
            if (!duration) return;
            takeOver();
            if (dragging) dragTimeRef.current = ratio * duration;
            seekTo(ratio * duration);
          },
          drag: (on) => {
            dragging = on;
            if (!on) {
              dragTimeRef.current = null;
              paint();
            }
          },
        })
      : () => undefined;
    const onSeekKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const duration = durationOf(video);
      const target = seekTargetForKey(event.key, video.currentTime || 0, duration);
      if (target === null) return;
      event.preventDefault();
      event.stopPropagation();
      takeOver();
      seekTo(target);
    };
    seek?.addEventListener('keydown', onSeekKey);

    const unregister = registerPlayer(id, pauseQuietly, layer);

    apiRef.current = {
      togglePlay: () => {
        takeOver();
        if (video.paused || video.ended) {
          giveSound();
          start('visitor');
          return;
        }
        startedByRef.current = null;
        video.pause();
      },
      seekBy: (seconds) => {
        takeOver();
        seekTo((video.currentTime || 0) + seconds);
      },
      toggleMute: () => {
        // The visitor has set the sound: Play never changes it from now on.
        soundOnPlayRef.current = false;
        takeOver();
        video.muted = !video.muted;
      },
      toggleCaptions: () => {
        const track = video.textTracks[0];
        if (!track) return;
        const on = track.mode !== 'showing';
        track.mode = on ? 'showing' : 'hidden';
        onState({ captionsOn: on });
      },
      toggleFullscreen: () => {
        takeOver();
        const current = frameLatest.current;
        const webkit = video as WebkitVideo;
        if (!document.fullscreenEnabled && !current.isFullscreen && typeof webkit.webkitEnterFullscreen === 'function') {
          try {
            webkit.webkitEnterFullscreen();
            return;
          } catch {
            // The metadata has not loaded yet: use the frame's own full-screen overlay instead.
          }
        }
        current.toggleFullscreen();
      },
    };

    // React sets `src` while it renders, before this effect: the element may have loaded its
    // metadata, or failed, before any listener above was attached.
    onState({ ready: true, muted: video.muted, duration: durationOf(video) });
    if (video.error) onState({ failed: true, playing: false, waiting: false });
    paint();
    // The effect runs once per mount (its inputs never change), so this starts playback once.
    if (playOnReadyRef.current) {
      takeOver();
      giveSound();
      start('visitor');
    }

    return () => {
      stopLoop();
      unregister();
      apiRef.current = null;
      for (const [type, handler] of listeners) video.removeEventListener(type, handler);
      tracks.removeEventListener('change', onTracks);
      detachGestures();
      seek?.removeEventListener('keydown', onSeekKey);
      // A player that leaves the page (or a route that is hidden) stops playing.
      video.pause();
    };
  }, [apiRef, id, layer, ledger, onState, pauseQuietly, seekRef, start, takeOver, timeRef]);

  // How much of the video is in view, for the autoplay rule; out of view entirely, it pauses.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !('IntersectionObserver' in window)) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (!entry) return;
        const viewHeight = entry.rootBounds?.height ?? window.innerHeight;
        const share = entry.isIntersecting
          ? viewShare(entry.intersectionRatio, entry.boundingClientRect.height, viewHeight)
          : 0;
        shareRef.current = share;
        handleRef.current?.setShare(visibleRef.current ? share : 0);
        if (!entry.isIntersecting) {
          // Nothing plays out of view, the visitor's own playback included.
          pauseQuietly();
          onLeaveRef.current();
        }
      },
      { threshold: SHARE_THRESHOLDS },
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, [pauseQuietly]);

  // The autoplay rule (playback.ts): joined while autoplay is allowed and the visitor has not taken
  // the player over.
  const mayAutoplay = autoplay && !refused;
  useEffect(() => {
    if (!mayAutoplay || modeRef.current === 'visitor') return undefined;
    const handle = joinAutoplay(id, {
      layer,
      play: () => {
        const video = videoRef.current;
        if (!video || modeRef.current !== 'auto') return;
        video.muted = true;
        start('auto');
      },
      stop: () => {
        if (startedByRef.current === 'auto') pauseQuietly();
      },
    });
    handleRef.current = handle;
    handle.setShare(visibleRef.current ? shareRef.current : 0);
    return () => {
      handle.leave();
      if (handleRef.current === handle) handleRef.current = null;
      // Autoplay is no longer allowed (reduced motion, the pause control): what played by itself stops.
      if (startedByRef.current === 'auto') pauseQuietly();
    };
  }, [id, layer, mayAutoplay, pauseQuietly, start]);

  // Nothing plays while the tab is hidden (docs/V3_PLAN.md D-66); the rule counts the video out.
  useEffect(() => {
    if (!visible) pauseQuietly();
    handleRef.current?.setShare(visible ? shareRef.current : 0);
  }, [pauseQuietly, visible]);

  const markSeeked = useCallback(() => {
    seekedRef.current = true;
  }, []);

  const captionsSrc = media.captionsSrc;
  return (
    <>
      {/* Muted from its creation (motion sheet 6.1, Loading); React sets it once, so the visitor's
          sound choice is never undone by a render. */}
      <video
        ref={videoRef}
        className={styles.video}
        src={media.file.src}
        preload="metadata"
        playsInline
        muted
        // Captions from another origin (Vercel Blob) load only through CORS.
        crossOrigin={captionsSrc && isRemoteUrl(captionsSrc) ? 'anonymous' : undefined}
      >
        {captionsSrc && <track kind="captions" src={captionsSrc} srcLang="en" label={UI.viewers.video.captionsTrack} />}
      </video>
      {scrubRun && (
        <ScrubDriver videoRef={videoRef} scrubRun={scrubRun} active={scrubbing} onSeek={markSeeked} pause={pauseQuietly} />
      )}
    </>
  );
}

interface ScrubProps {
  videoRef: RefObject<HTMLVideoElement>;
  /** Scroll drives the playhead now: the visitor has not pressed play. */
  active: boolean;
  /** A seek was asked for (the poster steps aside when its frame is decoded). */
  onSeek: () => void;
  /** Pauses the video, for the page's own reason. */
  pause: () => void;
}

/**
 * Scroll scrubbing (motion sheet 6.2; ARCHITECTURE.md 13A, the `scrub` option). The stylesheet
 * keeps the run (app/motion-media.css): its length is the spacer's height and the pin is the
 * stage's sticky top. This measures both and, while there is a run, ties the playhead to the
 * scroll through it.
 */
function ScrubDriver({ scrubRun, ...rest }: ScrubProps & { scrubRun: ScrubRun }) {
  const { run, stage, spacer } = scrubRun;
  const [geometry, setGeometry] = useState<{ top: number; length: number } | null>(null);

  useLayoutEffect(() => {
    const runElement = run.current;
    const stageElement = stage.current;
    const spacerElement = spacer.current;
    if (!runElement || !stageElement || !spacerElement) return undefined;
    const measure = () => {
      const top = parseFloat(getComputedStyle(stageElement).top);
      const next = { top: Number.isFinite(top) ? top : 0, length: spacerElement.offsetHeight };
      setGeometry((prev) => (prev && prev.top === next.top && prev.length === next.length ? prev : next));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    // The run's box changes with its length, with the frame's width (the pin follows the frame),
    // and with the reduced-motion and pause settings, which take the run away.
    const observer = new ResizeObserver(measure);
    observer.observe(runElement);
    return () => observer.disconnect();
  }, [run, spacer, stage]);

  if (!geometry || geometry.length <= 0) return null;
  return <ScrubBinding {...rest} run={run} top={geometry.top} length={geometry.length} />;
}

/**
 * The run's progress (Motion's useScroll: 0 as the pin starts, 1 as it ends) times the duration is
 * the playhead, through the scrub spring, so seeking never stutters. Nothing here sets React state
 * on scroll: the spring's value goes straight to the video, one seek at a time.
 */
function ScrubBinding({
  videoRef,
  run,
  top,
  length,
  active,
  onSeek,
  pause,
}: ScrubProps & { run: RefObject<HTMLDivElement>; top: number; length: number }) {
  const [duration, setDuration] = useState(0);
  const { scrollYProgress } = useScroll({ target: run, offset: scrubOffset(top, length) });
  const time = useTransform(scrollYProgress, (progress) => scrubTime(progress, duration));
  const smooth = useSpring(time, SCRUB_SPRING);
  const activeRef = useRef(active);
  activeRef.current = active;
  /** The latest playhead asked for while a seek was running. */
  const pendingRef = useRef<number | null>(null);

  const apply = useCallback(
    (target: number) => {
      const video = videoRef.current;
      if (!video || !Number.isFinite(target)) return;
      if (video.seeking) {
        pendingRef.current = target;
        return;
      }
      if (Math.abs((video.currentTime || 0) - target) < FRAME) return;
      onSeek();
      video.currentTime = target;
    },
    [onSeek, videoRef],
  );

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    const onDuration = () => setDuration(durationOf(video));
    const onSeeked = () => {
      const target = pendingRef.current;
      pendingRef.current = null;
      if (target !== null && activeRef.current) apply(target);
    };
    onDuration();
    video.addEventListener('durationchange', onDuration);
    video.addEventListener('loadedmetadata', onDuration);
    video.addEventListener('seeked', onSeeked);
    return () => {
      video.removeEventListener('durationchange', onDuration);
      video.removeEventListener('loadedmetadata', onDuration);
      video.removeEventListener('seeked', onSeeked);
    };
  }, [apply, videoRef]);

  useMotionValueEvent(smooth, 'change', (latest) => {
    if (activeRef.current) apply(latest);
  });

  // Scroll takes the playhead: at the start, and when the video comes back from the visitor's
  // own playback after leaving the view.
  useEffect(() => {
    if (!active) return;
    pause();
    apply(smooth.get());
  }, [active, apply, pause, smooth]);

  return null;
}
