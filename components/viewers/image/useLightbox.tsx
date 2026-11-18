'use client';

import dynamic from 'next/dynamic';
import { X } from 'lucide-react';
import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Icon from '@/components/sheet/Icon';
import { UI } from '@/lib/strings';
import { useFocusTrap } from '../shared/hooks';
import type { LightboxProps } from './Lightbox';

/**
 * The lightbox loads on demand: its code (zoom, pan, the dialog, and the video and model viewers
 * it may show) is a separate chunk that is fetched the first time a visitor opens a photo or a
 * gallery item, and never in a page's first load (ARCHITECTURE.md 13A). LazyLightbox draws the
 * loading state itself (next/dynamic gives its loading component no props), so the visitor can
 * cancel the open while the code is on its way.
 */
const Lightbox = dynamic(() => import('./Lightbox'), { ssr: false, loading: () => null });

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
  return createPortal(
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
    </div>,
    document.body,
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
 */
export function LazyLightbox(props: LightboxProps) {
  const [shown, setShown] = useState(false);
  const onShown = useCallback(() => setShown(true), []);
  return (
    <LightboxBoundary onError={props.onClose}>
      {!shown && <LightboxLoading label={props.label ?? UI.viewers.image.lightbox} onClose={props.onClose} />}
      <Lightbox {...props} onShown={onShown} />
    </LightboxBoundary>
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
