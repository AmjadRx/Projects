'use client';

import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Maximize2, Minimize2, Search } from 'lucide-react';
import { forwardRef, useEffect, useId, useState, type HTMLAttributes, type ReactNode } from 'react';
import type { ResolvedMedia } from '@/lib/media';
import { UI } from '@/lib/strings';
import { cn } from '@/lib/utils';
import Poster from '../shared/Poster';
import { useViewerFrame } from '../shared/ViewerFrame';
import styles from './reader.module.css';
import type { ReaderSearch } from './useReaderSearch';

/**
 * The poster (the first page as an image). With no poster image, the quiet placeholder; while
 * the load button sits over it, the placeholder is the bare grid, so the button does not cover
 * the placeholder's icon and type label.
 */
export function ReaderPoster({ media, waitingForTap }: { media: ResolvedMedia; waitingForTap: boolean }) {
  if (!media.poster && waitingForTap) return <div className="viewer-placeholder" aria-hidden />;
  return <Poster media={media} />;
}

/**
 * A labelled toolbar button: 44 px target, the label as its name and its tooltip. A disabled
 * button stays focusable (aria-disabled, not disabled) and ignores presses, so a press that
 * reaches a limit (the last page, the deepest zoom) never drops keyboard focus.
 */
export function ToolButton({
  label,
  onClick,
  disabled = false,
  pressed,
  className,
  children,
  ...aria
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** Set only on toggles, so plain buttons carry no pressed state. */
  pressed?: boolean;
  className?: string;
  children: ReactNode;
  'aria-expanded'?: boolean;
  'aria-controls'?: string;
}) {
  return (
    <button
      type="button"
      className={cn('viewer-button', className)}
      onClick={() => {
        if (!disabled) onClick();
      }}
      aria-disabled={disabled || undefined}
      aria-pressed={pressed}
      aria-label={label}
      title={label}
      {...aria}
    >
      {children}
    </button>
  );
}

/**
 * The full-screen button, placed by the reader inside its own toolbar so the controls can wrap
 * on a phone without leaving this button alone on a row. Same labels and behavior as the one
 * ViewerFrame draws for other viewers: the label says what a press does, with no pressed state.
 */
export function FullscreenButton({ className }: { className?: string }) {
  const { isFullscreen, toggleFullscreen } = useViewerFrame();
  const label = isFullscreen ? UI.viewers.exitFullscreen : UI.viewers.fullscreen;
  return (
    <ToolButton label={label} onClick={toggleFullscreen} className={className}>
      {isFullscreen ? <Minimize2 size={18} aria-hidden /> : <Maximize2 size={18} aria-hidden />}
    </ToolButton>
  );
}

/**
 * The scrolling page area of a reader: a focusable region named by the document, described by
 * the content's text description (from the frame) so the description is read when it takes focus.
 */
export const ReaderScroller = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement> & { label: string }>(
  function ReaderScroller({ label, className, ...rest }, ref) {
    const { descriptionId } = useViewerFrame();
    return (
      <div
        ref={ref}
        className={cn(styles.scroller, className)}
        tabIndex={0}
        role="region"
        aria-label={label}
        aria-describedby={descriptionId}
        {...rest}
      />
    );
  },
);

/** "Page 3 of 12" split around its two numbers, so the page number can be a field. */
function pageOfParts(): [string, string, string] {
  const sample = UI.viewers.document.pageOf(111111, 222222);
  const first = sample.indexOf('111111');
  const second = sample.indexOf('222222');
  if (first < 0 || second < first) return [`${UI.viewers.document.page} `, ' / ', ''];
  return [sample.slice(0, first), sample.slice(first + 6, second), sample.slice(second + 6)];
}
const [PAGE_BEFORE, PAGE_BETWEEN, PAGE_AFTER] = pageOfParts();

/**
 * Page turning: previous, "Page [n] of N" with the number as a field, next. `onGo` receives the
 * page asked for (it may be out of range or not a number; the reader clamps it). The total stays
 * hidden until the document is ready, and keeps its width, so the row never shifts.
 */
export function PageControl({
  page,
  total,
  ready,
  onGo,
}: {
  page: number;
  total: number | null;
  ready: boolean;
  onGo: (page: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const statusId = useId();
  const commit = () => {
    if (draft !== null && draft !== '') onGo(Number.parseInt(draft, 10));
    setDraft(null);
  };
  return (
    <div className="flex items-center gap-1">
      <ToolButton label={UI.viewers.document.previousPage} onClick={() => onGo(page - 1)} disabled={!ready || page <= 1}>
        <ChevronLeft size={18} aria-hidden />
      </ToolButton>
      <span className="data flex items-center gap-1.5 text-sm text-ink-dim">
        <span aria-hidden>{PAGE_BEFORE.trim()}</span>
        <input
          className={cn(styles.field, styles.pageField)}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          aria-label={UI.viewers.document.page}
          aria-describedby={statusId}
          disabled={!ready}
          value={draft ?? String(page)}
          onChange={(event) => setDraft(event.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commit();
            } else if (event.key === 'Escape') {
              setDraft(null);
            }
          }}
        />
        <span aria-hidden className={cn('min-w-[3.5ch]', !ready && 'invisible')}>
          {`${PAGE_BETWEEN.trim()} ${total ?? 0}${PAGE_AFTER}`}
        </span>
        <span id={statusId} className="sr-only" aria-live="polite">
          {ready && total ? UI.viewers.document.pageOf(page, total) : ''}
        </span>
      </span>
      <ToolButton
        label={UI.viewers.document.nextPage}
        onClick={() => onGo(page + 1)}
        disabled={!ready || total === null || page >= total}
      >
        <ChevronRight size={18} aria-hidden />
      </ToolButton>
    </div>
  );
}

/** On phones the search row opens from this button; wider screens always show the row. */
export function SearchToggle({ search, ready }: { search: ReaderSearch<{ page: number }>; ready: boolean }) {
  return (
    <ToolButton
      label={UI.viewers.document.search}
      onClick={search.toggleOpen}
      disabled={!ready}
      aria-expanded={search.open}
      aria-controls={search.rowId}
      className="md:hidden"
    >
      <Search size={18} aria-hidden />
    </ToolButton>
  );
}

/** Search: the field, previous and next match, and the count. */
export function SearchRow({ search, ready }: { search: ReaderSearch<{ page: number }>; ready: boolean }) {
  const count = search.matches.length;
  return (
    <div
      id={search.rowId}
      className={cn(
        'items-center gap-1 max-md:order-1 max-md:basis-full md:flex md:min-w-[18rem] md:flex-1',
        search.open ? 'flex' : 'hidden',
      )}
    >
      <input
        ref={search.fieldRef}
        className={cn(styles.field, styles.searchField, 'flex-1')}
        type="search"
        enterKeyHint="search"
        autoComplete="off"
        spellCheck={false}
        aria-label={UI.viewers.document.search}
        placeholder={UI.viewers.document.search}
        disabled={!ready}
        value={search.query}
        onChange={(event) => search.setQuery(event.target.value)}
        onKeyDown={search.onKeyDown}
      />
      <ToolButton label={UI.viewers.document.searchPrevious} onClick={() => search.step(-1)} disabled={!ready || count === 0}>
        <ChevronUp size={18} aria-hidden />
      </ToolButton>
      <ToolButton label={UI.viewers.document.searchNext} onClick={() => search.step(1)} disabled={!ready || count === 0}>
        <ChevronDown size={18} aria-hidden />
      </ToolButton>
      <span role="status" className="data min-w-[7.5rem] whitespace-nowrap text-xs text-ink-mute">
        {search.status}
      </span>
    </div>
  );
}

/** A short line over the poster (loading, or the failure message), announced politely. */
export function WellNotice({ children }: { children: ReactNode }) {
  return (
    <div className={styles.notice} role="status">
      <span className={styles.noticeText}>{children}</span>
    </div>
  );
}

/** Rendered by the error boundary in place of a crashed engine: reports the failure once. */
export function FailSignal({ onFail }: { onFail: () => void }) {
  useEffect(() => {
    onFail();
  }, [onFail]);
  return null;
}
