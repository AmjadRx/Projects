'use client';

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { UI } from '@/lib/strings';
import { normalizeQuery } from './search';

/** Typing waits this long before a search runs; Enter runs it at once. */
const SEARCH_DELAY_MS = 300;

/** The search state a reader's toolbar shows (ReaderParts: SearchToggle, SearchRow). */
export interface ReaderSearch<M extends { page: number }> {
  query: string;
  setQuery: (query: string) => void;
  /** Every match of the current search, in reading order. */
  matches: readonly M[];
  /** The index of the current match, or -1. */
  current: number;
  /** The count line: loading, "Match n of N", or no matches. Empty with no query. */
  status: string;
  /** Moves to the next (1) or previous (-1) match, wrapping around. */
  step: (delta: number) => void;
  /** Enter runs the search, or moves to the next match (Shift with Enter: the previous). */
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  /** Phones: the search row opens from a button. */
  open: boolean;
  toggleOpen: () => void;
  fieldRef: RefObject<HTMLInputElement>;
  rowId: string;
}

const NONE: readonly never[] = [];

/**
 * Search for the document readers, shared by the PDF reader (the engine searches pdf.js text)
 * and the Word reader (the sandboxed frame searches its document). The reader supplies:
 *
 * - `search`: resolves with every match of a normalized query, each with its page (from 1).
 * - `clear`: removes the highlights when the query is emptied (optional).
 * - `onSelect`: shows a match (turns to its page, highlights it as the current one).
 *
 * A new search starts at the first match on or after the page being read.
 */
export function useReaderSearch<M extends { page: number }>({
  enabled,
  page,
  search,
  clear,
  onSelect,
}: {
  /** False until the document has loaded: nothing runs before. */
  enabled: boolean;
  page: number;
  search: (query: string) => Promise<M[]>;
  clear?: () => void;
  onSelect: (match: M, index: number) => void;
}): ReaderSearch<M> {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<{ query: string; matches: M[] } | null>(null);
  const [current, setCurrent] = useState(-1);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const fieldRef = useRef<HTMLInputElement>(null);
  const rowId = useId();
  const runId = useRef(0);

  // The latest inputs, read by the stable search runner below.
  const latest = useRef({ page, search, clear, onSelect });
  latest.current = { page, search, clear, onSelect };

  const runSearch = useCallback(async (raw: string) => {
    const normalized = normalizeQuery(raw);
    runId.current += 1;
    const id = runId.current;
    if (!normalized) {
      setResult(null);
      setCurrent(-1);
      setSearching(false);
      latest.current.clear?.();
      return;
    }
    setSearching(true);
    let matches: M[] = [];
    try {
      matches = await latest.current.search(normalized);
    } catch {
      matches = [];
    }
    if (id !== runId.current) return;
    setSearching(false);
    setResult({ query: normalized, matches });
    if (matches.length === 0) {
      setCurrent(-1);
      return;
    }
    const after = matches.findIndex((match) => match.page >= latest.current.page);
    const index = after >= 0 ? after : 0;
    setCurrent(index);
    latest.current.onSelect(matches[index], index);
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    const timer = window.setTimeout(() => void runSearch(query), normalizeQuery(query) ? SEARCH_DELAY_MS : 0);
    return () => window.clearTimeout(timer);
  }, [query, enabled, runSearch]);

  const matches: readonly M[] = result?.matches ?? NONE;
  const step = (delta: number) => {
    if (matches.length === 0) return;
    const next = current < 0 ? 0 : (current + delta + matches.length) % matches.length;
    setCurrent(next);
    latest.current.onSelect(matches[next], next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (result && result.query === normalizeQuery(query) && !searching) step(event.shiftKey ? -1 : 1);
    else void runSearch(query);
  };

  const toggleOpen = () => {
    const next = !open;
    setOpen(next);
    if (next) window.setTimeout(() => fieldRef.current?.focus(), 0);
  };

  let status = '';
  const normalized = normalizeQuery(query);
  if (normalized) {
    if (searching) status = UI.viewers.loading;
    else if (result && result.query === normalized) {
      status = matches.length > 0 ? UI.viewers.document.matches(current + 1, matches.length) : UI.viewers.document.noMatches;
    }
  }

  return { query, setQuery, matches, current, status, step, onKeyDown, open, toggleOpen, fieldRef, rowId };
}
