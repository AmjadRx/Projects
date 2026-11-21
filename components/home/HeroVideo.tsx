'use client';

import { Pause, Play } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import Icon from '@/components/sheet/Icon';
import { useDocumentVisible } from '@/components/viewers/shared/hooks';
import {
  PlaybackLedger,
  holdPlayback,
  joinAutoplay,
  registerPlayer,
  releasePlayback,
  shareThresholds,
  viewShare,
  type AutoplayHandle,
} from '@/components/viewers/video/playback';
import { easeCss, media, toMs } from '@/lib/motion';
import { useMotionPaused } from '@/lib/motionPause';
import { useMotionOk } from '@/lib/useMotionOk';
import { heroJoinsAutoplay, heroPress, videoMayAutoplay, type HeroVideoMode } from './hero/videoPlayback';

/** The page's layer (playback.ts): a lightbox over the page covers the hero and pauses it. */
const PAGE_LAYER = 0;

/** The share of the video in view, observed in tenths and at 0.6 exactly (playback.ts). */
const SHARE_THRESHOLDS = shareThresholds(media.video.shareStep, media.video.inView);

/** Who started the playback under way: the autoplay rule, or the visitor. */
type Starter = 'auto' | 'visitor';

/** The browser's data saver (navigator.connection.saveData), where the browser reports it. */
function saveDataOn(): boolean {
  try {
    return Boolean((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData);
  } catch {
    return false;
  }
}

/**
 * The hero in `media` mode with a video: "a muted looping video with a poster" (ARCHITECTURE.md
 * 6; motion sheets 4.5 and 6.1; D-60). The poster arrives as server HTML through `children` and
 * paints first, so the hero never changes size and the poster is never downloaded twice.
 *
 * Playback follows the video rules of sheet 6.1, as a video block does, through the page's one
 * rule (components/viewers/video/playback.ts; the hero's part in ./hero/videoPlayback.ts):
 *
 * - It plays by itself, muted and looped, while it is the video most in view of those at least
 *   media.video.inView in view (the autoplay rule, on the page's layer), and pauses when it drops
 *   below or another video is more in view. Its file starts loading when the frame comes within
 *   media.video.preloadMargin of the view. The poster gives way in media.video.posterOut once the
 *   first frame plays.
 * - It never plays by itself under reduced motion, with Save-Data on, or while the visitor has
 *   paused motion in the footer: the poster stays, and the button plays it.
 * - The Play and Pause button is always there (D-60). A press takes the video over for the rest of
 *   the page view: it never plays by itself again. The visitor's Play pauses every other player and
 *   holds playback while it plays (no video plays by itself meanwhile); Pause holds until Play.
 * - Whoever started it, it pauses when it leaves the view entirely, when the tab is hidden (D-66),
 *   when another player starts, and when a lightbox opens over the page; the rule may start it
 *   again only while it is not the visitor's.
 *
 * Its media events are read with playback.ts's PlaybackLedger: a play or pause the page asked for
 * is the page's, any other the visitor's (the button, or the browser's own controls).
 *
 * No viewer code is involved. Drawn in the media frame of the design system (bundle MediaFrame: a
 * night well and a glass bar), at the video's own ratio and at most 78 percent of the window's
 * height.
 */
export default function HeroVideo({
  src,
  label,
  aspect,
  labels,
  children,
}: {
  src: string;
  /** The content's alt text for the video, exactly as stored. */
  label: string;
  aspect: number;
  labels: { play: string; pause: string };
  children: ReactNode;
}) {
  const id = useId();
  const frameRef = useRef<HTMLDivElement>(null);
  const wellRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const motionOk = useMotionOk();
  const motionPaused = useMotionPaused();
  const visible = useDocumentVisible();
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const [saveData, setSaveData] = useState(false);
  const auto = videoMayAutoplay({ motionOk, paused: motionPaused, saveData });

  const [mounted, setMounted] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [shown, setShown] = useState(false);
  /** The browser refused to start the muted video by itself (a phone saving power). */
  const [refused, setRefused] = useState(false);
  /** 'auto' until the visitor uses the button (or the browser's own controls); then 'visitor' for good. */
  const modeRef = useRef<HeroVideoMode>('auto');
  /** Who started the playback under way, as of the last call (its events arrive later). */
  const startedByRef = useRef<Starter | null>(null);
  /** Which play and pause events the page caused, and which the visitor did (playback.ts). */
  const [ledger] = useState(() => new PlaybackLedger());
  const handleRef = useRef<AutoplayHandle | null>(null);
  /** The share of the video in view at the last observation. */
  const shareRef = useRef(0);
  /** The visitor pressed Play before the video was on the page: start it once it is. */
  const playOnMountRef = useRef(false);

  /** Pauses for a reason of the page's own: the rule, another player, the lightbox, the view, the tab. */
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
      // A muted loop: no sound ever starts here (ARCHITECTURE.md 6; sheet 6.1).
      video.muted = true;
      video.play()?.catch((error: unknown) => {
        const name = error instanceof DOMException ? error.name : '';
        // Refused outright, so no event was queued for it.
        if (by === 'auto' && (name === 'NotAllowedError' || name === 'NotSupportedError')) ledger.autoStartRefused();
        // A browser that will not start it by itself: it leaves the rule, and the button plays it.
        if (by === 'auto' && name === 'NotAllowedError') setRefused(true);
        if (!video.paused) return;
        if (startedByRef.current === by) startedByRef.current = null;
        setPlaying(false);
      });
    },
    [ledger],
  );

  /** The visitor has taken the video over: it leaves the autoplay rule for the rest of the page view. */
  const takeOver = useCallback(() => {
    if (modeRef.current === 'visitor') return;
    modeRef.current = 'visitor';
    handleRef.current?.leave();
    handleRef.current = null;
  }, []);

  useEffect(() => {
    setSaveData(saveDataOn());
  }, []);

  // One player at a time: another player starting, or a lightbox opening over the page, pauses it.
  useEffect(() => registerPlayer(id, pauseQuietly, PAGE_LAYER), [id, pauseQuietly]);

  // How much of the video is in view, for the autoplay rule; out of view entirely it pauses,
  // whoever started it.
  useEffect(() => {
    const well = wellRef.current;
    if (!well || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (!entry) return;
        const viewHeight = entry.rootBounds?.height ?? window.innerHeight;
        const share = entry.isIntersecting ? viewShare(entry.intersectionRatio, entry.boundingClientRect.height, viewHeight) : 0;
        shareRef.current = share;
        handleRef.current?.setShare(visibleRef.current ? share : 0);
        if (!entry.isIntersecting) pauseQuietly();
      },
      { threshold: SHARE_THRESHOLDS },
    );
    observer.observe(well);
    return () => observer.disconnect();
  }, [pauseQuietly]);

  // While it may play by itself, near the view: put the video on the page, so its file loads.
  useEffect(() => {
    const frame = frameRef.current;
    if (!auto || mounted || saveDataOn() || !frame || typeof IntersectionObserver === 'undefined') return;
    const near = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setMounted(true);
      },
      { rootMargin: `${media.video.preloadMargin}px` },
    );
    near.observe(frame);
    return () => near.disconnect();
  }, [auto, mounted]);

  // The autoplay rule (playback.ts), while the hero takes part in it.
  useEffect(() => {
    if (!heroJoinsAutoplay({ mode: modeRef.current, mayAutoplay: auto, mounted, refused })) return undefined;
    const handle = joinAutoplay(id, {
      layer: PAGE_LAYER,
      play: () => {
        if (modeRef.current === 'auto') start('auto');
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
      // It may no longer play by itself (reduced motion, the pause control): what it played stops.
      if (startedByRef.current === 'auto') pauseQuietly();
    };
  }, [auto, id, mounted, pauseQuietly, refused, start]);

  // Nothing plays in a hidden tab (D-66); the rule counts the video out until the tab is shown.
  useEffect(() => {
    if (!visible) pauseQuietly();
    handleRef.current?.setShare(visible ? shareRef.current : 0);
  }, [pauseQuietly, visible]);

  // The visitor pressed Play before the video was on the page.
  useEffect(() => {
    if (!mounted || !playOnMountRef.current) return;
    playOnMountRef.current = false;
    start('visitor');
  }, [mounted, start]);

  const toggle = () => {
    const video = videoRef.current;
    const press = heroPress({ mounted: Boolean(video), playing: Boolean(video && !video.paused) });
    takeOver();
    if (press === 'pause') {
      // Not counted in the ledger: its pause event reads as the visitor's.
      startedByRef.current = null;
      video?.pause();
    } else if (press === 'play') {
      start('visitor');
    } else {
      playOnMountRef.current = true;
      setMounted(true);
    }
  };

  return (
    <div ref={frameRef} className="ar-mv hm-hero__media" style={{ width: `min(100%, calc(78vh * ${aspect.toFixed(4)}))` }}>
      <div ref={wellRef} className="ar-mv__well" style={{ aspectRatio: String(aspect) }}>
        {children}
        {mounted && (
          <video
            ref={videoRef}
            src={src}
            muted
            loop
            playsInline
            preload="metadata"
            aria-label={label || undefined}
            className="absolute inset-0 h-full w-full object-contain"
            style={{ opacity: shown ? 1 : 0, transition: `opacity ${toMs(media.video.posterOut)}ms ${easeCss.fade}` }}
            onPlay={(event) => {
              if (!ledger.onPlay()) {
                // The visitor's start (the button, or the browser's own controls): it holds playback.
                takeOver();
                startedByRef.current = 'visitor';
                holdPlayback(id, 'pause');
              }
              setPlaying(!event.currentTarget.paused);
            }}
            onPlaying={(event) => {
              if (!event.currentTarget.paused) setShown(true);
            }}
            onPause={(event) => {
              const video = event.currentTarget;
              // A pause the page did not ask for is the visitor's.
              if (!ledger.onPause() && !video.ended) {
                takeOver();
                startedByRef.current = null;
              }
              // Started again since: that start's own events report it.
              if (!video.paused) return;
              startedByRef.current = null;
              releasePlayback(id);
              setPlaying(false);
            }}
          />
        )}
      </div>
      <div className="ar-mv__bar">
        <button type="button" className="ar-mv__btn ar-mv__btn--text" onClick={toggle}>
          <Icon icon={playing ? Pause : Play} size={18} />
          <span>{playing ? labels.pause : labels.play}</span>
        </button>
      </div>
    </div>
  );
}
