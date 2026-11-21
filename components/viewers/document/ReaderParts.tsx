'use client';

import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Search } from 'lucide-react';
import { forwardRef, useEffect, useId, useState, type HTMLAttributes, type ReactNode } from 'react';
import Icon from '@/components/sheet/Icon';
import type { ResolvedMedia } from '@/lib/media';
import { UI } from '@/lib/strings';
import { cn } from '@/lib/utils';
import Poster from '../shared/Poster';
import { useViewerFrame } from '../shared/ViewerFrame';
import styles from './reader.module.css';
import type { ReaderSearch } from './useReaderSearch';

/**
 * The poster (the first page as an image), contained in the well as the page sheet. With no poster
 * image, the well's quiet placeholder; while the load button sits over it, the bare grid, so the
 * button does not cover the placeholder's mark and type.
 */
export function ReaderPoster({
  media,
  waitingForTap,
  wellAspect,
}: {
  media: ResolvedMedia;
  waitingForTap: boolean;
  wellAspect: number;
}) {
  if (!media.poster && waitingForTap) return null;
  return <Poster media={media} wellAspect={wellAspect} />;
}

/**
 * A labelled bar button (bundle .ar-mv__btn): a 44 px target, the label as its name and its
 * tooltip. A disabled button stays focusable (aria-disabled, not disabled) and ignores presses, so
 * a press that reaches a limit (the last page, the deepest zoom) never drops keyboard focus.
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
      className={cn('ar-mv__btn', className)}
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
 * hidden until the document is ready, and keeps its width, so the bar never shifts.
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
    <div className="ar-mv__group">
      <ToolButton label={UI.viewers.document.previousPage} onClick={() => onGo(page - 1)} disabled={!ready || page <= 1}>
        <Icon icon={ChevronLeft} size={18} />
      </ToolButton>
      <span className={styles.pageOf}>
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
        <span aria-hidden className={cn(styles.total, !ready && styles.hidden)}>
          {`${PAGE_BETWEEN.trim()} ${total ?? 0}${PAGE_AFTER}`}
        </span>
        <span id={statusId} className="ar-sr" aria-live="polite">
          {ready && total ? UI.viewers.document.pageOf(page, total) : ''}
        </span>
      </span>
      <ToolButton
        label={UI.viewers.document.nextPage}
        onClick={() => onGo(page + 1)}
        disabled={!ready || total === null || page >= total}
      >
        <Icon icon={ChevronRight} size={18} />
      </ToolButton>
    </div>
  );
}

/** On phones the search row opens from this button; wider frames always show the row. */
export function SearchToggle({ search, ready }: { search: ReaderSearch<{ page: number }>; ready: boolean }) {
  return (
    <ToolButton
      label={UI.viewers.document.search}
      onClick={search.toggleOpen}
      disabled={!ready}
      aria-expanded={search.open}
      aria-controls={search.rowId}
      className={styles.searchToggle}
    >
      <Icon icon={Search} size={18} />
    </ToolButton>
  );
}

/** Search (bundle .ar-mv__search): the field with its mark, previous and next match, and the count. */
export function SearchRow({ search, ready }: { search: ReaderSearch<{ page: number }>; ready: boolean }) {
  const count = search.matches.length;
  return (
    <div id={search.rowId} className={cn(styles.searchRow, search.open && styles.searchOpen)}>
      <label className="ar-mv__search">
        <Icon icon={Search} size={16} />
        <input
          ref={search.fieldRef}
          className={styles.searchField}
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
      </label>
      <ToolButton label={UI.viewers.document.searchPrevious} onClick={() => search.step(-1)} disabled={!ready || count === 0}>
        <Icon icon={ChevronUp} size={18} />
      </ToolButton>
      <ToolButton label={UI.viewers.document.searchNext} onClick={() => search.step(1)} disabled={!ready || count === 0}>
        <Icon icon={ChevronDown} size={18} />
      </ToolButton>
      <span role="status" className={styles.count}>
        {search.status}
      </span>
    </div>
  );
}

/** A short line on a night plate over the poster (loading, or the failure message), announced politely. */
export function WellNotice({ children }: { children: ReactNode }) {
  return (
    <p className="ar-mv__note" role="status">
      {children}
    </p>
  );
}

/** Rendered by the error boundary in place of a crashed engine: reports the failure once. */
export function FailSignal({ onFail }: { onFail: () => void }) {
  useEffect(() => {
    onFail();
  }, [onFail]);
  return null;
}
