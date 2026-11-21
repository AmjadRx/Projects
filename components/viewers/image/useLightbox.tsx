'use client';

import dynamic from 'next/dynamic';
import { X } from 'lucide-react';
import { Component, useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Icon from '@/components/sheet/Icon';
import { cssEasing, media, toMs } from '@/lib/motion';
import { UI } from '@/lib/strings';
import { useMotionOk } from '@/lib/useMotionOk';
import { useFocusTrap } from '../shared/hooks';
import { openLayer } from '../video/playback';
import type { LightboxProps } from './Lightbox';

/**
 * The lightbox loads on demand: its code (zoom, pan, the dialog, and the video and model viewers
 * it may show) is a separate chunk that is fetched the first time a visitor opens a photo or a
 * gallery item, and never in a page's first load (ARCHITECTURE.md 13A). LazyLightbox draws the
 * loading state itself (next/dynamic gives its loading component no props), so the visitor can
 * cancel the open while the code is on its way.
 */
const Lightbox = dynamic(() => import('./Lightbox'), { ssr: false, loading: () => null });

/** The lightbox fading in and out (motion sheet 6.4), for app/motion-media.css. */
const LAYER_STYLE = {
  '--mm-lb-in': `${toMs(media.gallery.lightboxIn.duration)}ms`,
  '--mm-lb-in-ease': cssEasing(media.gallery.lightboxIn.ease),
  '--mm-lb-out': `${toMs(media.gallery.lightboxOut.duration)}ms`,
  '--mm-lb-out-ease': cssEasing(media.gallery.lightboxOut.ease),
} as CSSProperties;

/**
 * Shown for the moment the lightbox code takes to arrive: the lightbox itself (bundle Lightbox,
 * state "loading"), with Close in its corner and an empty stage; after 600 ms a 2 px line runs
 * along the stage's foot (not under reduced motion). Escape or Close cancels the open, and the
 * lightbox never appears after. Focus stays inside, and the page behind does not scroll, as in the
 * lightbox itself.
 */
function LightboxLoading({ label, onClose }: { label: string; onClose: () => void }) {
  const coverRef = useRef<HTMLDivElement>(null);
  // Focus returns to the opener through useLightbox when the open is cancelled; when the lightbox
  // takes over, focus is already inside it and stays there.
  useFocusTrap(coverRef, true, onClose, { restoreFocus: false });
  return (
    <div ref={coverRef} role="dialog" aria-modal="true" aria-label={label} aria-busy="true" className="ar-lightbox ar-lightbox--one">
      <div className="ar-lightbox__top">
        <button type="button" className="ar-iconbtn" onClick={onClose} aria-label={UI.viewers.close} title={UI.viewers.close}>
          <Icon icon={X} size={20} />
        </button>
      </div>
      <div className="ar-lightbox__stage">
        <span className="ar-lightbox__bar" aria-hidden="true" />
        <span className="ar-sr" role="status">
          {UI.viewers.loading}
        </span>
      </div>
      <div className="ar-lightbox__bottom" aria-hidden="true" />
    </div>
  );
}

/** If the lightbox code cannot load (offline, say), the dialog closes and the page stays as it was. */
class LightboxBoundary extends Component<
  { onError: () => void; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: Error): void {
    if (process.env.NODE_ENV !== 'production') console.error('Lightbox failed to load', error);
    this.props.onError();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * The lightbox, fetched on first use. Render it only while it is open: closing it (from the
 * loading cover too) unmounts it, so code that arrives after a cancel opens nothing.
 *
 * Motion (motion sheet 6.4): the loading cover and the lightbox share one layer on <body>, which
 * fades in over the page in 200 ms when it opens and out in 150 ms when it closes, then unmounts,
 * and focus goes back to the opener. While it fades out a shield takes any click, so a quick second
 * click lands on nothing. Without motion (reduced motion, /admin) it opens and closes at once. While
 * it is open the page's players pause, and only the lightbox's own may play by themselves
 * (components/viewers/video/playback.ts).
 */
export function LazyLightbox(props: LightboxProps) {
  const { onClose } = props;
  const motionOk = useMotionOk();
  const [shown, setShown] = useState(false);
  const [closing, setClosing] = useState(false);
  const onShown = useCallback(() => setShown(true), []);

  useEffect(() => openLayer(), []);

  const requestClose = useCallback(() => {
    if (motionOk) setClosing(true);
    else onClose();
  }, [motionOk, onClose]);

  useEffect(() => {
    if (!closing) return undefined;
    const timer = window.setTimeout(onClose, toMs(media.gallery.lightboxOut.duration));
    return () => window.clearTimeout(timer);
  }, [closing, onClose]);

  return createPortal(
    <div
      className="mm-lb"
      data-motion={motionOk ? '' : undefined}
      data-closing={closing ? '' : undefined}
      style={LAYER_STYLE}
    >
      <LightboxBoundary onError={onClose}>
        {!shown && <LightboxLoading label={props.label ?? UI.viewers.image.lightbox} onClose={requestClose} />}
        <Lightbox {...props} onClose={requestClose} onShown={onShown} />
      </LightboxBoundary>
      {closing && <div className="mm-lb__shield" aria-hidden="true" />}
    </div>,
    document.body,
  );
}

/**
 * Open state for a lightbox, and focus return: when the lightbox closes, focus goes back to the
 * element that opened it, also in browsers that do not focus a button on click (docs/V3_PLAN.md D-63).
 */
export function useLightbox() {
  const [openAt, setOpenAt] = useState<number | null>(null);
  const opener = useRef<HTMLElement | null>(null);

  const open = useCallback((index: number, from: HTMLElement | null) => {
    opener.current = from;
    setOpenAt(index);
  }, []);

  const close = useCallback(() => setOpenAt(null), []);

  useEffect(() => {
    if (openAt !== null) return;
    const element = opener.current;
    opener.current = null;
    if (element && document.contains(element)) element.focus({ preventScroll: true });
  }, [openAt]);

  return { openAt, open, close };
}
