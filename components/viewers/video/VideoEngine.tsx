'use client';

import { useEffect, useId, useLayoutEffect, useRef } from 'react';
import { isRemoteUrl } from '@/lib/media';
import { useViewerFrame } from '../shared/ViewerFrame';
import { useDocumentVisible } from '../shared/hooks';
import type { VideoEngineProps } from './contract';
import { claimPlayback, registerPlayer } from './playback';
import { attachSeekGestures, seekTargetForKey, writeSliderValue } from './seek';
import { clamp, durationOf, formatClock, seekValueText } from './time';
import styles from './VideoPlayer.module.css';
import { UI } from '@/lib/strings';

/** iPhone Safari has no element full screen, only the video's own (docs/V3_PLAN.md D-63). */
type WebkitVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void };

/** Scrubbing stops this far before the end, so the last frame shows without ending playback. */
const END_GUARD = 0.05;

/**
 * The engine of the video player, loaded with next/dynamic only when the player nears the
 * viewport (ARCHITECTURE.md 13A): the <video> element with preload="metadata" and playsInline,
 * its events, the seek bar, captions, full screen, scroll scrubbing, and pausing when the tab
 * is hidden (docs/V3_PLAN.md D-66). Nothing plays by itself (docs/V3_PLAN.md D-60).
 */
export default function VideoEngine({
  media,
  scrubbing,
  playOnReady,
  apiRef,
  timeRef,
  seekRef,
  onState,
}: VideoEngineProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const frame = useViewerFrame();
  const frameLatest = useRef(frame);
  frameLatest.current = frame;
  const playOnReadyRef = useRef(playOnReady);
  const visible = useDocumentVisible();
  const id = useId();
  /** While the visitor drags the seek bar: the asked-for time, which the bar follows. */
  const dragTimeRef = useRef<number | null>(null);
  /** True once a seek was asked for: the poster steps aside when that frame is decoded. */
  const seekedRef = useRef(false);

  useLayoutEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;

    const seek = seekRef.current;

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

    const play = () => {
      const started = video.play();
      // A browser may refuse to start without a fresh tap; the play button stays for the visitor.
      started?.catch(() => onState({ playing: false, waiting: false }));
    };

    const reveal = () => {
      if (video.readyState >= 2) onState({ started: true });
    };

    const listeners: [string, () => void][] = [
      [
        'play',
        () => {
          claimPlayback(id);
          onState({ playing: true });
          startLoop();
        },
      ],
      [
        'pause',
        () => {
          stopLoop();
          onState({ playing: false, waiting: false });
          paint();
        },
      ],
      [
        'ended',
        () => {
          stopLoop();
          onState({ playing: false, waiting: false });
          paint();
        },
      ],
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
      seekTo(target);
    };
    seek?.addEventListener('keydown', onSeekKey);

    const unregister = registerPlayer(id, () => video.pause());

    apiRef.current = {
      togglePlay: () => {
        if (video.paused || video.ended) play();
        else video.pause();
      },
      seekBy: (seconds) => seekTo((video.currentTime || 0) + seconds),
      toggleMute: () => {
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
    if (playOnReadyRef.current) play();

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
  }, [apiRef, id, onState, seekRef, timeRef]);

  // Scroll scrubbing (ARCHITECTURE.md 13A, the `scrub` option): while the player is in view, a
  // passive scroll listener asks for one animation frame, and that frame sets the playhead from
  // where the player sits in the viewport. The video's own time is the only thing it changes;
  // seeks are chained, one at a time, so a fast scroll never queues stale frames.
  useEffect(() => {
    const video = videoRef.current;
    if (!scrubbing || !video) return undefined;
    video.pause();

    let frameId = 0;
    let listening = false;
    let pending: number | null = null;

    const apply = (target: number) => {
      if (video.seeking) {
        pending = target;
        return;
      }
      if (Math.abs((video.currentTime || 0) - target) < 1 / 60) return;
      seekedRef.current = true;
      video.currentTime = target;
    };
    const onSeeked = () => {
      if (pending === null) return;
      const target = pending;
      pending = null;
      apply(target);
    };
    const update = () => {
      frameId = 0;
      const duration = durationOf(video);
      if (!duration) return;
      const rect = video.getBoundingClientRect();
      const viewport = window.innerHeight || document.documentElement.clientHeight;
      if (!rect.height || !viewport) return;
      // 0 when the player's middle enters at the bottom of the viewport, 1 when it leaves at the top.
      const progress = clamp((viewport - (rect.top + rect.height / 2)) / viewport, 0, 1);
      apply(progress * Math.max(0, duration - END_GUARD));
    };
    const schedule = () => {
      if (!frameId) frameId = requestAnimationFrame(update);
    };
    const listen = (on: boolean) => {
      if (on === listening) return;
      listening = on;
      if (on) {
        window.addEventListener('scroll', schedule, { passive: true });
        window.addEventListener('resize', schedule, { passive: true });
        schedule();
      } else {
        window.removeEventListener('scroll', schedule);
        window.removeEventListener('resize', schedule);
        if (frameId) cancelAnimationFrame(frameId);
        frameId = 0;
      }
    };
    const onMetadata = () => {
      if (listening) schedule();
    };

    // Listen only while the player is in view; a browser without IntersectionObserver always listens.
    const observer =
      'IntersectionObserver' in window
        ? new IntersectionObserver((entries) => {
            const entry = entries[entries.length - 1];
            if (entry) listen(entry.isIntersecting);
          })
        : null;
    if (observer) observer.observe(video);
    else listen(true);
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('loadedmetadata', onMetadata);

    return () => {
      observer?.disconnect();
      listen(false);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('loadedmetadata', onMetadata);
    };
  }, [scrubbing]);

  // Nothing plays while the tab is hidden (docs/V3_PLAN.md D-66).
  useEffect(() => {
    if (!visible) videoRef.current?.pause();
  }, [visible]);

  const captionsSrc = media.captionsSrc;
  return (
    <video
      ref={videoRef}
      className={styles.video}
      src={media.file.src}
      preload="metadata"
      playsInline
      // Captions from another origin (Vercel Blob) load only through CORS.
      crossOrigin={captionsSrc && isRemoteUrl(captionsSrc) ? 'anonymous' : undefined}
    >
      {captionsSrc && <track kind="captions" src={captionsSrc} srcLang="en" label={UI.viewers.video.captionsTrack} />}
    </video>
  );
}
