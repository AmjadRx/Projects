'use client';

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { UI } from '@/lib/strings';
import { useDocumentVisible } from '../shared/hooks';
import { claimPlayback, registerPlayer } from '../video/playback';
import { attachSeekGestures, seekTargetForKey, writeSliderValue } from '../video/seek';
import { clamp, durationOf, formatClock, seekValueText } from '../video/time';
import type { AudioEngineProps } from './contract';
import styles from './AudioPlayer.module.css';
import { drawWaveform, readWaveColors, type WaveColors } from './waveform';

/**
 * The engine of the audio player, loaded with next/dynamic only when the player nears the
 * viewport (ARCHITECTURE.md 13A): the <audio> element, the seek control over the well
 * (role="slider": press, drag, tap, and keys, from components/viewers/video/seek.ts), and the
 * waveform, drawn on a canvas from the peaks stored with the media (`media.waveform`, computed
 * at upload). Without stored peaks the plain progress bar stays: the visitor's browser never
 * downloads or decodes the file to draw one. Pauses when the tab is hidden (docs/V3_PLAN.md D-66).
 */
export default function AudioEngine({ media, playOnReady, apiRef, timeRef, onState }: AudioEngineProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const sliderRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const colorsRef = useRef<WaveColors | null>(null);
  const paintRef = useRef<() => void>(() => undefined);
  const playOnReadyRef = useRef(playOnReady);
  const visible = useDocumentVisible();
  const id = useId();
  const [duration, setDuration] = useState(0);
  const stored = media.waveform;
  const peaks = useMemo(() => (stored && stored.length > 0 ? Float32Array.from(stored) : null), [stored]);
  const peaksRef = useRef(peaks);
  peaksRef.current = peaks;

  useLayoutEffect(() => {
    const audio = audioRef.current;
    const slider = sliderRef.current;
    if (!audio || !slider) return undefined;

    /** Writes the playhead into the readout, the seek control, and the waveform. No React render. */
    const paint = () => {
      const total = durationOf(audio);
      const current = clamp(audio.currentTime || 0, 0, total || Infinity);
      const progress = total > 0 ? clamp(current / total, 0, 1) : 0;
      const time = timeRef.current;
      const clock = formatClock(current);
      if (time && time.textContent !== clock) time.textContent = clock;
      slider.style.setProperty('--progress', `${progress * 100}%`);
      writeSliderValue(slider, current, seekValueText(current, total));
      const canvas = canvasRef.current;
      const levels = peaksRef.current;
      if (canvas && levels) {
        colorsRef.current ??= readWaveColors(slider);
        drawWaveform(canvas, levels, progress, colorsRef.current);
      }
    };
    paintRef.current = paint;

    // While playing, the waveform and the readout move every frame.
    let frameId = 0;
    const tick = () => {
      frameId = 0;
      if (audio.paused || audio.ended) return;
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
      const total = durationOf(audio);
      if (!total || !Number.isFinite(target)) return;
      audio.currentTime = clamp(target, 0, total);
      paint();
    };
    const play = () => {
      // A browser may refuse to start without a fresh tap; the play button stays for the visitor.
      audio.play()?.catch(() => onState({ playing: false }));
    };
    const onDuration = () => {
      const total = durationOf(audio);
      setDuration(total);
      onState({ duration: total });
      paint();
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
          onState({ playing: false });
          paint();
        },
      ],
      [
        'ended',
        () => {
          stopLoop();
          onState({ playing: false });
          paint();
        },
      ],
      ['timeupdate', paint],
      ['seeked', paint],
      ['loadedmetadata', onDuration],
      ['durationchange', onDuration],
      [
        'error',
        () => {
          stopLoop();
          onState({ failed: true, playing: false });
        },
      ],
    ];
    for (const [type, handler] of listeners) audio.addEventListener(type, handler);

    // Seeking on the waveform; handled keys stop here, so they do not also reach the page.
    const detachGestures = attachSeekGestures(slider, {
      area: () => canvasRef.current?.getBoundingClientRect() ?? null,
      seek: (ratio) => seekTo(ratio * durationOf(audio)),
    });
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const target = seekTargetForKey(event.key, audio.currentTime || 0, durationOf(audio));
      if (target === null) return;
      event.preventDefault();
      event.stopPropagation();
      seekTo(target);
    };
    slider.addEventListener('keydown', onKey);

    // Redraw when the well changes size, and when the theme changes the well's ink.
    const resize = 'ResizeObserver' in window ? new ResizeObserver(() => paint()) : null;
    resize?.observe(slider);
    const theme = new MutationObserver(() => {
      colorsRef.current = null;
      paint();
    });
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });

    const unregister = registerPlayer(id, () => audio.pause());
    apiRef.current = {
      togglePlay: () => {
        if (audio.paused || audio.ended) play();
        else audio.pause();
      },
      seekBy: (seconds) => seekTo((audio.currentTime || 0) + seconds),
    };

    // React sets `src` while it renders, before this effect: the element may have loaded its
    // metadata, or failed, before any listener above was attached.
    onState({ ready: true, duration: durationOf(audio) });
    if (audio.error) onState({ failed: true, playing: false });
    setDuration(durationOf(audio));
    paint();
    // The effect runs once per mount (its inputs never change), so this starts playback once.
    if (playOnReadyRef.current) play();

    return () => {
      stopLoop();
      unregister();
      apiRef.current = null;
      for (const [type, handler] of listeners) audio.removeEventListener(type, handler);
      detachGestures();
      slider.removeEventListener('keydown', onKey);
      resize?.disconnect();
      theme.disconnect();
      // A player that leaves the page (or a route that is hidden) stops playing.
      audio.pause();
    };
  }, [apiRef, id, onState, timeRef]);

  // Stored peaks are drawn as soon as the canvas exists (and again when they change).
  useEffect(() => {
    paintRef.current();
  }, [peaks]);

  // Nothing plays while the tab is hidden (docs/V3_PLAN.md D-66).
  useEffect(() => {
    if (!visible) audioRef.current?.pause();
  }, [visible]);

  const seekable = duration > 0;
  return (
    <>
      <audio ref={audioRef} src={media.file.src} preload="metadata" />
      {/* React renders aria-valuenow once, as 0; from then on `paint` writes it and the value text. */}
      <div
        ref={sliderRef}
        className={styles.slider}
        role="slider"
        tabIndex={0}
        aria-label={UI.viewers.audio.seek}
        aria-valuemin={0}
        aria-valuemax={Math.floor(duration)}
        aria-valuenow={0}
        aria-disabled={seekable ? undefined : true}
      >
        {peaks ? (
          <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />
        ) : (
          <div className={styles.track} aria-hidden="true">
            <div className={styles.fill} />
          </div>
        )}
      </div>
    </>
  );
}
