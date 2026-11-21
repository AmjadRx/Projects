'use client';

import { RotateCcw, VolumeX } from 'lucide-react';
import { useSpring, useTransform } from 'motion/react';
import * as m from 'motion/react-m';
import { useEffect, useId, useRef, useState } from 'react';
import { useDocumentVisible, useFinePointer } from '@/components/viewers/shared/hooks';
import { joinAutoplay, registerPlayer, shareThresholds, viewShare, type AutoplayHandle } from '@/components/viewers/video/playback';
import { inViewThresholds, swingAngle, swingTimeAt } from '@/lib/cardMotion';
import { cards, media } from '@/lib/motion';
import { saveDataOn } from '@/lib/sky/tier';
import { cn } from '@/lib/utils';
import { useCard, useCardMotion } from './cardContext';
import CoverImage from './CoverImage';
import { joinCoverRun } from './coverRun';
import Icon from './Icon';

export interface CardCoverLabels {
  /** The tag on the cover: "Video" or "3D model". */
  kind: string;
  /** The line while it runs: "Playing, muted" or "Turning". */
  live: string;
  didNotLoad: string;
  tryAgain: string;
}

const backSpring = { visualDuration: cards.model.back.visualDuration, bounce: cards.model.back.bounce };

/** The page's layer (playback.ts): a lightbox over the page covers the cards and pauses their videos. */
const PAGE_LAYER = 0;

/** The top of the share-in-view scale (playback.ts viewShare): the whole of it in view. */
const WHOLLY_IN_VIEW = 1;

/**
 * What a hovered cover reports to the autoplay rule: one step above the top of the share scale.
 * playback.ts compares shares in steps of media.video.shareStep and, between equals, keeps the
 * video already playing, so at WHOLLY_IN_VIEW a hovered cover would tie with any video more than
 * 0.95 in view and lose to it (the hero, on a tall or zoomed-out window with the cards on screen).
 * One step above, it ranks over every share a video in view can have. The rule's other checks
 * still come first: nothing plays by itself while what the visitor started holds playback, and a
 * layer over the page (the lightbox) plays only its own. setShare documents shares from 0 to 1;
 * pickAutoplay compares them as they are, and tests/playback-together.test.ts holds this against
 * the real playback.ts.
 */
const HOVERED_SHARE = WHOLLY_IN_VIEW + media.video.shareStep;

/**
 * Phones: the shares of the card in view that the observer reports at. The cover run's even steps
 * from 0.6 to 1, with the autoplay rule's tenths under them, so a card taller than the view still
 * reads as wholly in view once it fills the view (viewShare: a phone held sideways).
 */
const PHONE_THRESHOLDS = [
  ...new Set([...inViewThresholds(cards.phoneInView, cards.phoneInViewSteps), ...shareThresholds(media.video.shareStep, media.video.inView)]),
].sort((a, b) => a - b);

/** The card around a cover, which is what must be in view on a phone. */
function cardOf(el: Element | null): Element | null {
  return el?.closest('[data-card]') ?? el;
}

/**
 * A card cover that moves (motion sheet 5.2; the Cover-Video and Cover-Model boards): a video, or
 * the owner's 3D model shown by its poster. At rest it is the poster in the night well with its kind
 * on a tag, the same as the server drew it.
 *
 * - Desktop (a mouse or pen): it runs while the card is hovered. A video plays muted from its first
 *   frame; the poster stays until that frame is ready, then gives way in 150 ms, and a 2 px progress
 *   line runs along the foot with the video. When it stops it pauses, gives way back to the poster,
 *   and rewinds. A model's poster turns 28 degrees either way on a 6 s sine and comes back to rest
 *   with the tilt spring. A card never loads the 3D engine, so the poster turns, not the geometry.
 * - Phones and tablets: it may run while at least 0.6 of its card is in view, one cover at a time,
 *   the one most in view (./coverRun.ts), starting and stopping at once.
 * - Never under reduced motion, while motion is paused, or while the tab is hidden; a video never
 *   plays with Save-Data on, and a model never turns by itself then. A video only loads once its
 *   card is within 200 px of the view (preload "none" until then; docs/V3_PLAN.md D-60), and a
 *   browser that refuses to play it (Low Power Mode) leaves the poster, which works on its own.
 *
 * A video cover and the page's other players (components/viewers/video/playback.ts). A cover is a
 * video that plays by itself, muted, with no controls and never with sound (sheet 5.4), so it takes
 * part in the page's autoplay rule on the page's layer, beside the hero video and the video blocks:
 * of the videos that may play by themselves, the one most in view plays, one at a time (sheet 6.1).
 *
 * - On a phone the cover run's choice joins the rule at its card's share in view, so a video block
 *   or the hero more in view plays instead of it.
 * - On desktop a hover is the visitor asking for this preview (DESIGN_DIRECTION.md 6.3: hover a card
 *   and its video cover starts), so a hovered cover ranks over every video playing by itself,
 *   however much of that video is in view (HOVERED_SHARE): that video pauses, and plays again once
 *   the pointer leaves.
 * - A preview is muted and only a preview, so it never takes playback from what the visitor
 *   started. It never claims or holds playback (either would pause the visitor's own video, audio
 *   or embedded player): while a player the visitor started holds playback, the rule plays nothing
 *   by itself, so a hovered cover keeps its poster, and it plays once that playback ends if the
 *   pointer is still on the card.
 * - It registers on the page's layer, so a player the visitor starts pauses it at once, and so does
 *   a lightbox opening over the page; the rule starts it again when either is over, while it is
 *   still hovered or in view.
 */
export default function CardCover({
  kind,
  poster,
  video,
  sizes,
  priority,
  labels,
}: {
  kind: 'video' | 'model';
  /** The still that paints first; null for a cover with no poster (the bare night well). */
  poster: { src: string; alt: string; focal?: { x: number; y: number } } | null;
  /** The video file, for a video cover. */
  video?: string;
  sizes: string;
  priority: boolean;
  labels: CardCoverLabels;
}) {
  const card = useCard();
  const motionOk = useCardMotion();
  const fine = useFinePointer();
  const visible = useDocumentVisible();
  const id = useId();
  const wellRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const barRef = useRef<HTMLSpanElement>(null);
  const [saveData, setSaveData] = useState(false);
  /** Phones: this cover is the one most in view. */
  const [chosen, setChosen] = useState(false);
  /** The card is within the preload margin of the view: the video may load. */
  const [near, setNear] = useState(false);
  /** The video's first frame is up and the poster has given way. */
  const [shown, setShown] = useState(false);
  /** The browser refused to play the video: the poster stays until the next hover or view. */
  const [refused, setRefused] = useState(false);
  const [failed, setFailed] = useState(false);
  /** The autoplay rule plays this video cover now (playback.ts). */
  const [on, setOn] = useState(false);
  const handleRef = useRef<AutoplayHandle | null>(null);
  /** Phones: the card's share in view at the last observation (playback.ts viewShare). */
  const shareRef = useRef(0);

  useEffect(() => setSaveData(saveDataOn(window)), []);

  const isVideo = kind === 'video' && Boolean(video) && !failed;
  const loadVideo = isVideo && motionOk && !saveData;
  const allowed = motionOk && visible;
  const can = isVideo ? allowed && !saveData : kind === 'model' && allowed && (fine || !saveData);
  const wanted = fine ? Boolean(card?.hovered) : chosen;
  const mounted = loadVideo && near;
  /** A video cover asks the autoplay rule to play it while it is wanted and may play. */
  const joins = isVideo && can && wanted && mounted && !refused;
  /** A video cover runs while the rule plays it; a model cover turns while it is wanted. */
  const running = isVideo ? on : can && wanted;
  const runningRef = useRef(running);
  runningRef.current = running;
  const shownRef = useRef(shown);
  shownRef.current = shown;

  // A refusal lasts for this hover (or this stay in view); the next one tries again.
  useEffect(() => {
    setRefused(false);
  }, [wanted]);

  // The video file loads only once the card nears the view.
  useEffect(() => {
    if (!loadVideo || near) return undefined;
    const target = cardOf(wellRef.current);
    if (!target || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setNear(true);
      },
      { rootMargin: `${media.video.preloadMargin}px` },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [loadVideo, near]);

  // Phones and tablets: join the run of covers in view, with the card's share in view.
  useEffect(() => {
    if (fine || !can) return undefined;
    const target = cardOf(wellRef.current);
    if (!target || typeof IntersectionObserver === 'undefined') return undefined;
    const run = joinCoverRun(id, setChosen);
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const viewHeight = entry.rootBounds?.height ?? window.innerHeight;
          const share = entry.isIntersecting ? viewShare(entry.intersectionRatio, entry.boundingClientRect?.height ?? 0, viewHeight) : 0;
          shareRef.current = share;
          run.report(share);
          handleRef.current?.setShare(share);
        }
      },
      { threshold: PHONE_THRESHOLDS },
    );
    observer.observe(target);
    return () => {
      observer.disconnect();
      run.leave();
      setChosen(false);
      shareRef.current = 0;
    };
  }, [fine, can, id]);

  // The autoplay rule: a hovered cover ranks over every video in view; on a phone, its card's share.
  useEffect(() => {
    if (!joins) return undefined;
    const handle = joinAutoplay(id, { layer: PAGE_LAYER, play: () => setOn(true), stop: () => setOn(false) });
    handleRef.current = handle;
    handle.setShare(fine ? HOVERED_SHARE : shareRef.current);
    return () => {
      handle.leave();
      if (handleRef.current === handle) handleRef.current = null;
      // Leaving the rule stops nothing by itself (playback.ts): the cover stops its own video.
      setOn(false);
    };
  }, [fine, id, joins]);

  // One player at a time: a player the visitor starts, or a lightbox over the page, pauses it now.
  useEffect(() => {
    if (kind !== 'video') return undefined;
    return registerPlayer(
      id,
      () => {
        const el = videoRef.current;
        if (el && !el.paused) el.pause();
        setOn(false);
      },
      PAGE_LAYER,
    );
  }, [id, kind]);

  // Play and pause the video as the rule says.
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (on) {
      el.muted = true;
      el.play()?.catch((error: unknown) => {
        // A pause before playback began is not a refusal; Low Power Mode and autoplay rules are.
        if (runningRef.current && !(error instanceof DOMException && error.name === 'AbortError')) setRefused(true);
      });
    } else {
      if (!el.paused) el.pause();
      setShown(false);
    }
  }, [on, mounted]);

  // The progress line follows the video, frame by frame, only while it plays.
  useEffect(() => {
    const el = videoRef.current;
    const bar = barRef.current;
    if (!el || !bar || !running || !shown) return undefined;
    let frame = 0;
    const tick = () => {
      const duration = el.duration;
      const share = duration > 0 && Number.isFinite(duration) ? Math.min(1, el.currentTime / duration) : 0;
      bar.style.transform = `scaleX(${share})`;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [running, shown]);

  // The model's poster swings on a sine while the cover runs, and springs back to rest after a
  // hover; on a phone it stops at once, as it starts.
  const yaw = useSpring(0, backSpring);
  const turn = useTransform(yaw, (angle) => (angle === 0 ? 'none' : `perspective(${cards.tilt.perspective}px) rotateY(${angle}deg)`));
  useEffect(() => {
    const rest = () => (fine ? yaw.set(0) : yaw.jump(0));
    if (kind !== 'model' || !running) {
      rest();
      return undefined;
    }
    let frame = 0;
    let origin = -1;
    // From where the cover is, so a swing that starts while it springs back does not jump.
    const offset = swingTimeAt(yaw.get(), cards.model.swing, cards.model.cycle);
    const tick = (now: number) => {
      const seconds = now / 1000;
      if (origin < 0) origin = seconds - offset;
      yaw.jump(swingAngle(seconds - origin, cards.model.swing, cards.model.cycle));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      rest();
    };
  }, [kind, running, yaw, fine]);

  const live = kind === 'model' ? running : running && shown;

  return (
    <div ref={wellRef} className={cn('ar-well', 'ar-card__motion', live && 'is-live')}>
      <m.div className="ar-card__turn" style={kind === 'model' ? { transform: turn } : undefined}>
        {poster ? (
          <CoverImage
            src={poster.src}
            alt={poster.alt}
            focal={poster.focal}
            sizes={sizes}
            priority={priority}
            labels={{ didNotLoad: labels.didNotLoad, tryAgain: labels.tryAgain }}
          />
        ) : null}
      </m.div>
      {mounted ? (
        <m.video
          ref={videoRef}
          className="ar-card__video"
          src={video}
          muted
          loop
          playsInline
          preload="metadata"
          disablePictureInPicture
          aria-hidden="true"
          tabIndex={-1}
          initial={false}
          animate={{ opacity: shown ? 1 : 0 }}
          transition={{ duration: fine ? cards.video.posterOut : 0, ease: cards.video.posterEase }}
          onAnimationComplete={() => {
            // Back on the poster: rewind, so the next run plays from the first frame.
            const el = videoRef.current;
            if (el && !shownRef.current) el.currentTime = 0;
          }}
          onPlaying={() => {
            if (runningRef.current) setShown(true);
          }}
          onError={() => setFailed(true)}
        />
      ) : null}
      <span className="ar-card__kind">{labels.kind}</span>
      {live ? (
        <span className="ar-card__live">
          <Icon icon={kind === 'model' ? RotateCcw : VolumeX} size={16} />
          {labels.live}
        </span>
      ) : null}
      {kind === 'video' && live ? (
        <span className="ar-card__progress" aria-hidden="true">
          <span ref={barRef} />
        </span>
      ) : null}
    </div>
  );
}
