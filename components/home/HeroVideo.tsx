'use client';

import { Pause, Play } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * The hero in `media` mode with a video: "a muted looping video with a poster" (ARCHITECTURE.md
 * 6). The poster arrives as server HTML through `children` and paints first. Nothing plays by
 * itself in this phase: the Play button mounts a muted, looping video over the same poster, so
 * the hero never changes size, the poster is never downloaded twice, and the video file loads
 * only when the visitor asks for it. No viewer code is involved; Phase 5 adds the in-view start.
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
  const [started, setStarted] = useState(false);
  const [playing, setPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Nothing runs in a hidden tab (docs/V3_PLAN.md D-66).
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') videoRef.current?.pause();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const toggle = () => {
    const video = videoRef.current;
    if (!started || !video) {
      setStarted(true);
      return;
    }
    if (video.paused) void video.play().catch(() => setPlaying(false));
    else video.pause();
  };

  return (
    <div className="viewer-frame">
      <div className="viewer-well" style={{ aspectRatio: String(aspect), maxHeight: '78vh' }}>
        {children}
        {started && (
          <video
            ref={videoRef}
            src={src}
            muted
            loop
            playsInline
            autoPlay
            aria-label={label || undefined}
            className="absolute inset-0 h-full w-full object-contain"
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
          />
        )}
      </div>
      <div className="viewer-toolbar">
        <div className="viewer-toolbar__controls">
          <button type="button" className="viewer-button" onClick={toggle}>
            {playing ? <Pause size={18} aria-hidden /> : <Play size={18} aria-hidden />}
            <span className="text-sm">{playing ? labels.pause : labels.play}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
