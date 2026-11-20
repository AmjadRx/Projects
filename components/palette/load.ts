/**
 * Loads the command palette on demand (ARCHITECTURE.md 9: nothing but the nav's button and the
 * shortcut's listener is in a page's first load): the palette's code, a chunk of its own
 * (./CommandPalette.tsx), and its index, the static /palette.json (lib/palette.ts), fetched
 * together the first time either is wanted. A hover, a press or focus on the button, or an idle
 * moment after the page has loaded fetches them ahead, so the palette opens at once when asked
 * (motion sheet 7: "Opens at once over its scrim").
 */
import type { ComponentType } from 'react';
import type { PaletteIndex } from '@/lib/palette';
import { afterIntro } from '@/lib/intro';
import type { CommandPaletteProps } from './CommandPalette';

/** Where the index is served (app/palette.json/route.ts). */
export const PALETTE_INDEX_URL = '/palette.json';

/**
 * The idle fetch: after the load event (and, on the home page, the load sequence, so nothing lands
 * on its frames), at the browser's next idle moment, waited for at most IDLE_TIMEOUT_MS; a browser
 * without requestIdleCallback waits NO_IDLE_DELAY_MS instead. Loading numbers, not motion.
 */
const IDLE_TIMEOUT_MS = 3000;
const NO_IDLE_DELAY_MS = 1000;

export interface LoadedPalette {
  Palette: ComponentType<CommandPaletteProps>;
  index: PaletteIndex;
}

let loading: Promise<LoadedPalette> | null = null;

/** The index, or a failure (an HTTP status, or a file that is not an index); kept short, as it rides in every first load. */
async function fetchIndex(): Promise<PaletteIndex> {
  const response = await fetch(PALETTE_INDEX_URL, { credentials: 'same-origin' });
  if (!response.ok) throw new Error(String(response.status));
  const index = (await response.json()) as PaletteIndex;
  if (!Array.isArray(index?.groups) || !Array.isArray(index?.pages)) throw new TypeError(PALETTE_INDEX_URL);
  return index;
}

/**
 * The palette's code and index, fetched once a page view. A failed load is forgotten, so the next
 * press of the button or the shortcut tries again.
 */
export function loadPalette(): Promise<LoadedPalette> {
  if (!loading) {
    const attempt = Promise.all([import('./CommandPalette'), fetchIndex()]).then(([module, index]) => ({
      Palette: module.default,
      index,
    }));
    loading = attempt;
    attempt.catch(() => {
      if (loading === attempt) loading = null;
    });
  }
  return loading;
}

/** Fetches ahead of use; a failure is left for the press that needs it. */
export function prefetchPalette(): void {
  loadPalette().catch(() => {});
}

/** Forgets what was loaded (tests). */
export function resetPaletteLoad(): void {
  loading = null;
}

/**
 * Fetches the palette at the first idle moment after the page has loaded, unless the visitor saves
 * data (then the button's hover, press, or focus fetches it). Returns the function that cancels it.
 */
export function prefetchWhenIdle(win: Window = window): () => void {
  const connection = (win.navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (connection?.saveData) return () => {};
  let idleId: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopIntro = () => {};
  const idle = () => {
    if (typeof win.requestIdleCallback === 'function') idleId = win.requestIdleCallback(prefetchPalette, { timeout: IDLE_TIMEOUT_MS });
    else timer = setTimeout(prefetchPalette, NO_IDLE_DELAY_MS);
  };
  const loaded = () => {
    stopIntro = afterIntro(idle, win.document);
  };
  if (win.document.readyState === 'complete') loaded();
  else win.addEventListener('load', loaded, { once: true });
  return () => {
    win.removeEventListener('load', loaded);
    stopIntro();
    if (idleId !== undefined && typeof win.cancelIdleCallback === 'function') win.cancelIdleCallback(idleId);
    if (timer !== undefined) clearTimeout(timer);
  };
}
