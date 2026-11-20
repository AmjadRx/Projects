/**
 * The command palette's logic, kept apart from its markup (./CommandPalette.tsx) so each rule can
 * be tested on its own: the filter and its highlights, what each key does, and the state that keys
 * and typing move through.
 */
import type { PaletteIndex, PaletteItem } from '@/lib/palette';

/** A matched stretch of a label, [start, end) in UTF-16 units, drawn as the bundle's highlight. */
export interface PaletteHit {
  start: number;
  end: number;
}

export interface PaletteResult extends PaletteItem {
  /** The result's place in the whole list, across groups: what the arrow keys count. */
  n: number;
  hits: PaletteHit[];
}

export interface PaletteResultGroup {
  label: string;
  items: PaletteResult[];
}

export interface PaletteResults {
  groups: PaletteResultGroup[];
  /** Every result in list order. */
  flat: PaletteResult[];
}

/** The query's words: split at white space, so "raven road" finds "Raven: Roadmap". */
export function queryWords(query: string): string[] {
  return query.trim().split(/\s+/).filter(Boolean);
}

/** A case-insensitive search for a piece of text, read literally. */
function finder(text: string): RegExp {
  return new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'iu');
}

/**
 * Where the query shows in a label, or null when it does not match. A label matches when it holds
 * every word of the query, in any order and without regard to case. The highlight is the whole
 * query where the label holds it as typed (as the bundle marks it), else the first place of each
 * word, joined where they touch. An empty query matches everything and marks nothing.
 */
export function matchLabel(label: string, query: string): PaletteHit[] | null {
  const words = queryWords(query);
  if (words.length === 0) return [];
  const spots: PaletteHit[] = [];
  for (const word of words) {
    const found = finder(word).exec(label);
    if (!found) return null;
    spots.push({ start: found.index, end: found.index + found[0].length });
  }
  const whole = finder(query.trim()).exec(label);
  if (whole) return [{ start: whole.index, end: whole.index + whole[0].length }];
  spots.sort((a, b) => a.start - b.start);
  const hits: PaletteHit[] = [];
  for (const spot of spots) {
    const last = hits[hits.length - 1];
    if (last && spot.start <= last.end) last.end = Math.max(last.end, spot.end);
    else hits.push({ ...spot });
  }
  return hits;
}

/**
 * The results for a query: each group's matching items in the index's own order (pages, then
 * projects in order, then sections in page order; the Palette boards' grouping), empty groups left
 * out, and every result numbered across the groups.
 */
export function searchPalette(index: PaletteIndex, query: string): PaletteResults {
  const flat: PaletteResult[] = [];
  const groups: PaletteResultGroup[] = [];
  for (const group of index.groups) {
    const items: PaletteResult[] = [];
    for (const item of group.items) {
      const hits = matchLabel(item.label, query);
      if (!hits) continue;
      const result = { ...item, n: flat.length, hits };
      items.push(result);
      flat.push(result);
    }
    if (items.length > 0) groups.push({ label: group.label, items });
  }
  return { groups, flat };
}

/** The parts of a key event that decide what a key does in the field. */
export interface PaletteKeyEvent {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  isComposing?: boolean;
}

/** What a key does: move, open the result, close, keep focus inside, or nothing (null). */
export type PaletteKey = 'next' | 'previous' | 'go' | 'close' | 'tab' | null;

/**
 * The palette's keys (the WAI-ARIA combobox with a listbox): Down and Up move through the results,
 * Enter opens the active one, Escape closes, and Tab stays inside the dialog. Every other key, and
 * these with a modifier (Shift+Up selects text, Ctrl+Enter is the browser's), is left to the field
 * and the browser, as is anything typed while an input method composes. Tab keeps Shift, which
 * reverses it.
 */
export function paletteKey(event: PaletteKeyEvent): PaletteKey {
  if (event.isComposing) return null;
  if (event.key === 'Escape') return 'close';
  if (event.key === 'Tab') return event.altKey || event.ctrlKey || event.metaKey ? null : 'tab';
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null;
  if (event.key === 'ArrowDown') return 'next';
  if (event.key === 'ArrowUp') return 'previous';
  if (event.key === 'Enter') return 'go';
  return null;
}

/** The palette's state: what is typed, and which result is active (it keeps the visual focus). */
export interface PaletteState {
  query: string;
  active: number;
}

export const PALETTE_START: PaletteState = { query: '', active: 0 };

export type PaletteEvent =
  /** The field changed: the first result becomes active. */
  | { type: 'query'; query: string }
  /** Down or Up, over `count` results: one step, round from the last to the first and back. */
  | { type: 'next' | 'previous'; count: number }
  /** The pointer rests on a result. */
  | { type: 'point'; n: number };

export function paletteStep(state: PaletteState, event: PaletteEvent): PaletteState {
  switch (event.type) {
    case 'query':
      return event.query === state.query && state.active === 0 ? state : { query: event.query, active: 0 };
    case 'next':
    case 'previous': {
      if (event.count <= 0) return state;
      const from = Math.min(Math.max(state.active, 0), event.count - 1);
      const by = event.type === 'next' ? 1 : -1;
      return { ...state, active: (from + by + event.count) % event.count };
    }
    case 'point':
      return event.n === state.active ? state : { ...state, active: event.n };
    default:
      return state;
  }
}

/** The active result, or none when nothing matches. */
export function activeResult(results: PaletteResults, state: PaletteState): PaletteResult | null {
  if (results.flat.length === 0) return null;
  return results.flat[Math.min(Math.max(state.active, 0), results.flat.length - 1)];
}
