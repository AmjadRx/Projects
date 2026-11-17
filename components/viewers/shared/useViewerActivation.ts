'use client';

import { useCallback, useEffect, useState, type RefObject } from 'react';

/**
 * When a viewer loads its engine (ARCHITECTURE.md 13A, DESIGN_DIRECTION.md 11):
 *
 * - `view`: when the viewer comes near the viewport, on every device. For light engines.
 * - `view-or-tap`: near the viewport on a desktop with a fine pointer; on phones and tablets the
 *   poster waits for a tap. For heavy engines (3D, documents).
 *
 * Either way, on a metered or slow connection (Save-Data, 2g, 3g) every viewer waits for a tap.
 * Until the effect runs (and on the server) the viewer is inactive: the poster always paints first.
 */
export type ActivationPolicy = 'view' | 'view-or-tap';

interface NetworkInformationLike {
  saveData?: boolean;
  effectiveType?: string;
}

function onSlowConnection(): boolean {
  const connection = (navigator as Navigator & { connection?: NetworkInformationLike }).connection;
  if (!connection) return false;
  if (connection.saveData) return true;
  return /^(slow-2g|2g|3g)$/.test(connection.effectiveType ?? '');
}

export function prefersTapToLoad(policy: ActivationPolicy): boolean {
  if (typeof window === 'undefined') return false;
  if (onSlowConnection()) return true;
  if (policy === 'view') return false;
  return !window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}

export interface ViewerActivation {
  /** True once the engine may load. */
  active: boolean;
  /** True when the poster must offer a button to load the engine. */
  requiresTap: boolean;
  /** Load the engine now (the tap, or a keyboard press on the poster button). */
  activate: () => void;
}

export function useViewerActivation(ref: RefObject<Element>, policy: ActivationPolicy): ViewerActivation {
  const [active, setActive] = useState(false);
  const [requiresTap, setRequiresTap] = useState(false);

  useEffect(() => {
    if (active) return undefined;
    if (prefersTapToLoad(policy)) {
      setRequiresTap(true);
      return undefined;
    }
    const element = ref.current;
    if (!element || !('IntersectionObserver' in window)) {
      setActive(true);
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setActive(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px 0px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [active, policy, ref]);

  const activate = useCallback(() => {
    setRequiresTap(false);
    setActive(true);
  }, []);

  return { active, requiresTap, activate };
}
