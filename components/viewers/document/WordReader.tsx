'use client';

import { FileText, MoveHorizontal, ZoomIn, ZoomOut } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import Icon from '@/components/sheet/Icon';
import type { ResolvedMedia } from '@/lib/media';
import { UI } from '@/lib/strings';
import { failureText } from '../shared/DownloadLink';
import TapToLoad from '../shared/TapToLoad';
import ViewerFrame from '../shared/ViewerFrame';
import { useViewerActivation } from '../shared/useViewerActivation';
import {
  PageControl,
  ReaderPoster,
  ReaderScroller,
  SearchRow,
  SearchToggle,
  ToolButton,
  WellNotice,
} from './ReaderParts';
import { clamp, WORD_SCALE, ZOOM_STEP, type WordZoom } from './reader-types';
import { MAX_MATCHES } from './search';
import { useReaderSearch } from './useReaderSearch';
import styles from './reader.module.css';

/**
 * Word documents render inside a sandboxed frame (docs/V3_PLAN.md D-28): docx-preview builds the
 * document's HTML without sanitizing it, so it runs only in public/viewers/docx-frame.html, loaded
 * with sandbox="allow-scripts" and never allow-same-origin. That page has an opaque origin and a
 * policy of its own, so nothing in a file can reach this page or the network. This reader fetches
 * the file, posts its bytes to the frame, and sizes the frame to the document it draws.
 *
 * Page turning and search work as in the PDF reader, through messages: the frame reports where
 * each page starts (docx-preview draws one section per page), and it finds and highlights search
 * matches inside the document, answering with numbers only (each match's page, the current
 * match's box). This page scrolls its own page area to the page or the match.
 */
const FRAME_SRC = '/viewers/docx-frame.html';
/** The reader's well (bundle DocumentReader): 4:3, the document at its full width, scrolling inside. */
const DOCUMENT_ASPECT = 4 / 3;
/** Larger files are offered only as a download. */
const MAX_BYTES = 50_000_000;
/**
 * The frame must load its scripts in this time, and draw the document in the next. A frame whose
 * page has loaded but whose scripts never reported (blocked, or missing) fails sooner.
 */
const READY_TIMEOUT_MS = 15_000;
const READY_AFTER_LOAD_MS = 3_000;
const RENDER_TIMEOUT_MS = 30_000;
/** A search the frame does not answer in this time counts as no matches. */
const SEARCH_TIMEOUT_MS = 10_000;
/** The largest side, in px, accepted from the frame. */
const MAX_SIDE = 1_000_000;
/** The most pages accepted from the frame. */
const MAX_PAGES = 10_000;
/** The largest message id, and the longest query: the frame accepts the same. */
const MAX_ID = 2_147_483_647;
const MAX_QUERY = 1000;
/** Space left above a page that a page turn scrolls to, in CSS px. */
const PAGE_GAP = 8;

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

type FrameMessage =
  | { type: 'docx:ready' }
  | { type: 'docx:error' }
  | { type: 'docx:rendered' | 'docx:size'; width: number; height: number; pages: number[] }
  | { type: 'docx:found'; id: number; pages: number[] }
  | ({ type: 'docx:selected'; id: number; index: number; page: number } & Box);

const isInt = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
const isNum = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

/** Page tops: 1 to MAX_PAGES offsets in range, in order. */
function readPages(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_PAGES) return null;
  let previous = 0;
  for (const top of value) {
    if (!isNum(top, 0, MAX_SIDE) || top < previous) return null;
    previous = top;
  }
  return value.slice() as number[];
}

/**
 * Accepts only the frame's own message shapes, with numbers that are finite and in range. The
 * frame sends numbers only; nothing it sends is ever written into this page as text or markup.
 */
function readFrameMessage(data: unknown): FrameMessage | null {
  if (!data || typeof data !== 'object') return null;
  const message = data as Record<string, unknown>;
  const { type } = message;
  if (type === 'docx:ready' || type === 'docx:error') return { type };
  if (type === 'docx:rendered' || type === 'docx:size') {
    const { width, height } = message;
    const pages = readPages(message.pages);
    if (!isNum(width, 1, MAX_SIDE) || !isNum(height, 1, MAX_SIDE) || !pages) return null;
    return { type, width, height, pages };
  }
  if (type === 'docx:found') {
    const { id, pages } = message;
    if (!isInt(id, 0, MAX_ID) || !Array.isArray(pages) || pages.length > MAX_MATCHES) return null;
    if (!pages.every((page) => isInt(page, 1, MAX_PAGES))) return null;
    return { type, id, pages: pages.slice() as number[] };
  }
  if (type === 'docx:selected') {
    const { id, index, page, top, left, width, height } = message;
    if (!isInt(id, 0, MAX_ID) || !isInt(index, 0, MAX_MATCHES - 1) || !isInt(page, 1, MAX_PAGES)) return null;
    if (!isNum(top, 0, MAX_SIDE) || !isNum(left, 0, MAX_SIDE) || !isNum(width, 0, MAX_SIDE) || !isNum(height, 0, MAX_SIDE)) {
      return null;
    }
    return { type, id, index, page, top, left, width, height };
  }
  return null;
}

interface Size {
  width: number;
  height: number;
}

interface MatchPage {
  page: number;
}

export default function WordReader({ media, label, caption }: { media: ResolvedMedia; label: string; caption?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const { active, requiresTap, activate } = useViewerActivation(hostRef, 'view-or-tap');
  const [tapped, setTapped] = useState(false);
  const [failed, setFailed] = useState(false);
  const [frameLoaded, setFrameLoaded] = useState(false);
  const [frameReady, setFrameReady] = useState(false);
  const [bytes, setBytes] = useState<ArrayBuffer | null>(null);
  const [sent, setSent] = useState(false);
  const [natural, setNatural] = useState<Size | null>(null);
  const [pages, setPages] = useState<number[] | null>(null);
  const [page, setPage] = useState(1);
  const [box, setBox] = useState<Size | null>(null);
  const [zoom, setZoom] = useState<WordZoom>({ mode: 'width' });

  const live = active && !failed;
  const ready = live && natural !== null && pages !== null;

  /** Sends a message to the frame. Its origin is opaque, so the target origin is "*". */
  const post = useCallback((message: Record<string, unknown>, transfer?: Transferable[]) => {
    const target = frameRef.current?.contentWindow;
    if (!target) return false;
    target.postMessage(message, '*', transfer ?? []);
    return true;
  }, []);

  // The file's bytes, fetched once the reader is active.
  useEffect(() => {
    if (!live) return undefined;
    const controller = new AbortController();
    fetch(media.file.src, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('Too large');
        return response.arrayBuffer();
      })
      .then((buffer) => {
        if (buffer.byteLength === 0 || buffer.byteLength > MAX_BYTES) throw new Error('Size out of range');
        setBytes(buffer);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [live, media.file.src]);

  // ---------------------------------------------------------------------------------------------
  // Where things are: the scale, the sheet in the page area, and each page's top (in the
  // document's own pixels), kept in refs for the message and scroll handlers.
  const fitWidth = natural && box && box.width > 0 ? Math.floor((box.width / natural.width) * 10000) / 10000 : null;
  // The scale: the full width, or the reader's choice. Rounded down, so a fitted page never
  // overflows the well by a pixel.
  const scale = fitWidth === null ? null : clamp(zoom.mode === 'width' ? fitWidth : zoom.scale, WORD_SCALE.min, WORD_SCALE.max);
  const geometry = useRef<{ scale: number | null; pages: number[] | null }>({ scale: null, pages: null });
  geometry.current = { scale, pages };
  /** Set by a page turn or a match: the scroll position it chose and the page it showed. */
  const navigated = useRef<{ top: number; page: number } | null>(null);

  /** The page being read: the one under the middle of the page area (where a match is centered). */
  const pageFromScroll = useCallback((): number | null => {
    const scroller = scrollerRef.current;
    const sheet = sheetRef.current;
    const { scale: s, pages: tops } = geometry.current;
    if (!scroller || !sheet || s === null || !tops) return null;
    const chosen = navigated.current;
    if (chosen && Math.abs(scroller.scrollTop - chosen.top) < 2) return chosen.page;
    navigated.current = null;
    const scrollable = scroller.scrollHeight > scroller.clientHeight + 2;
    const atEnd = scrollable && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
    // At the very end, a short last page that can never reach the top line still counts.
    if (atEnd && sheet.offsetTop + tops[tops.length - 1] * s < scroller.scrollTop + scroller.clientHeight) return tops.length;
    const line = (scroller.scrollTop + scroller.clientHeight / 2 - sheet.offsetTop) / s;
    let found = 1;
    for (let i = 0; i < tops.length; i += 1) if (tops[i] <= line) found = i + 1;
    return found;
  }, []);

  const goToPage = useCallback((target: number) => {
    const { scale: s, pages: tops } = geometry.current;
    const scroller = scrollerRef.current;
    const sheet = sheetRef.current;
    if (!tops || !Number.isFinite(target)) return;
    const next = clamp(Math.round(target), 1, tops.length);
    if (scroller && sheet && s !== null) {
      scroller.scrollTop = Math.max(0, sheet.offsetTop + tops[next - 1] * s - PAGE_GAP);
      navigated.current = { top: scroller.scrollTop, page: next };
    }
    setPage(next);
  }, []);

  /** Scrolls the current match into view when it is outside the page area, and turns to its page. */
  const revealMatch = useCallback((match: Box & { page: number }) => {
    const scroller = scrollerRef.current;
    const sheet = sheetRef.current;
    const s = geometry.current.scale;
    if (!scroller || !sheet || s === null) return;
    const x = sheet.offsetLeft + match.left * s;
    const y = sheet.offsetTop + match.top * s;
    const width = match.width * s;
    const height = match.height * s;
    const margin = 24;
    const outside =
      y < scroller.scrollTop + margin ||
      y + height > scroller.scrollTop + scroller.clientHeight - margin ||
      x < scroller.scrollLeft ||
      x + width > scroller.scrollLeft + scroller.clientWidth;
    if (outside) {
      scroller.scrollLeft = Math.max(0, x - (scroller.clientWidth - width) / 2);
      scroller.scrollTop = Math.max(0, y - (scroller.clientHeight - height) / 2);
    }
    navigated.current = { top: scroller.scrollTop, page: match.page };
    setPage(match.page);
  }, []);

  // ---------------------------------------------------------------------------------------------
  // Search: the frame finds and highlights the matches; this page keeps the count and the
  // current one. Each search has an id, so a late answer to an older one is ignored.
  const searchId = useRef(0);
  /** The search whose matches the toolbar shows: the frame's answer to a select carries it. */
  const shownSearch = useRef(-1);
  const pendingSearch = useRef<{ id: number; finish: (pages: number[]) => void } | null>(null);

  const searchFrame = useCallback(
    (query: string): Promise<MatchPage[]> =>
      new Promise((resolve) => {
        if (query.length > MAX_QUERY) {
          resolve([]);
          return;
        }
        // A search still waiting for its answer is replaced: it ends empty, and the toolbar drops it.
        pendingSearch.current?.finish([]);
        searchId.current = (searchId.current % MAX_ID) + 1;
        const id = searchId.current;
        let timer = 0;
        const finish = (found: number[]) => {
          window.clearTimeout(timer);
          if (pendingSearch.current?.id === id) pendingSearch.current = null;
          resolve(found.map((matchPage) => ({ page: matchPage })));
        };
        timer = window.setTimeout(() => finish([]), SEARCH_TIMEOUT_MS);
        pendingSearch.current = { id, finish };
        if (!post({ type: 'docx:search', id, query })) finish([]);
      }),
    [post],
  );

  const clearSearch = useCallback(() => {
    pendingSearch.current?.finish([]);
    searchId.current = (searchId.current % MAX_ID) + 1;
    shownSearch.current = -1;
    post({ type: 'docx:search', id: searchId.current, query: '' });
  }, [post]);

  const selectMatch = useCallback(
    (_match: MatchPage, index: number) => {
      post({ type: 'docx:select', id: shownSearch.current, index });
    },
    [post],
  );

  const search = useReaderSearch<MatchPage>({ enabled: ready, page, search: searchFrame, clear: clearSearch, onSelect: selectMatch });

  // Messages from the frame: only from its window, which has the opaque origin "null".
  useEffect(() => {
    if (!live) return undefined;
    const onMessage = (event: MessageEvent) => {
      const frame = frameRef.current;
      if (!frame || event.source !== frame.contentWindow || event.origin !== 'null') return;
      const message = readFrameMessage(event.data);
      if (!message) return;
      switch (message.type) {
        case 'docx:ready':
          setFrameReady(true);
          break;
        case 'docx:error':
          setFailed(true);
          break;
        case 'docx:found':
          if (pendingSearch.current?.id === message.id) {
            shownSearch.current = message.id;
            pendingSearch.current.finish(message.pages);
          }
          break;
        case 'docx:selected':
          if (message.id === shownSearch.current) revealMatch(message);
          break;
        default: {
          const { width, height } = message;
          setNatural((previous) => (previous && previous.width === width && previous.height === height ? previous : { width, height }));
          setPages((previous) =>
            previous && previous.length === message.pages.length && previous.every((top, i) => top === message.pages[i])
              ? previous
              : message.pages,
          );
        }
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [live, revealMatch]);

  // The bytes go to the frame once, transferred (not copied), when both are ready.
  useEffect(() => {
    if (!frameReady || !bytes || sent || !frameRef.current?.contentWindow) return;
    setSent(true);
    setBytes(null);
    post({ type: 'docx:render', data: bytes }, [bytes]);
  }, [frameReady, bytes, sent, post]);

  // A frame that never loads, or never draws, falls back to the poster and the download link.
  useEffect(() => {
    if (!live || frameReady) return undefined;
    const timer = window.setTimeout(() => setFailed(true), frameLoaded ? READY_AFTER_LOAD_MS : READY_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [live, frameReady, frameLoaded]);
  useEffect(() => {
    if (!live || !sent || natural) return undefined;
    const timer = window.setTimeout(() => setFailed(true), RENDER_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [live, sent, natural]);

  // The well's size, for fitting the width.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!live || !scroller) return undefined;
    const measure = () => {
      const next = { width: scroller.clientWidth, height: scroller.clientHeight };
      setBox((previous) => (previous && previous.width === next.width && previous.height === next.height ? previous : next));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [live]);

  useEffect(() => {
    if (live && tapped) scrollerRef.current?.focus({ preventScroll: true });
  }, [live, tapped]);

  useEffect(() => {
    if (scale === null) return;
    post({ type: 'docx:scale', scale });
  }, [scale, natural, post]);

  // Zooming in or out keeps the same point in the middle of the well; fitting the width keeps
  // the top edge where it was.
  const lastScroll = useRef({ left: 0, top: 0 });
  const lastScale = useRef<number | null>(null);
  const zoomModeRef = useRef(zoom.mode);
  useLayoutEffect(() => {
    zoomModeRef.current = zoom.mode;
  }, [zoom.mode]);
  const onScroll = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    lastScroll.current = { left: scroller.scrollLeft, top: scroller.scrollTop };
    const current = pageFromScroll();
    if (current !== null) setPage(current);
  }, [pageFromScroll]);
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || scale === null) return;
    const previous = lastScale.current;
    lastScale.current = scale;
    if (previous === null || previous === scale) return;
    const ratio = scale / previous;
    const { left, top } = lastScroll.current;
    const halfWidth = zoomModeRef.current === 'custom' ? scroller.clientWidth / 2 : 0;
    const halfHeight = zoomModeRef.current === 'custom' ? scroller.clientHeight / 2 : 0;
    scroller.scrollLeft = Math.max(0, (left + halfWidth) * ratio - halfWidth);
    scroller.scrollTop = Math.max(0, (top + halfHeight) * ratio - halfHeight);
    lastScroll.current = { left: scroller.scrollLeft, top: scroller.scrollTop };
  }, [scale]);

  // A new scale or new page positions move the pages under the reading line.
  useEffect(() => {
    const current = pageFromScroll();
    if (current !== null) setPage(current);
  }, [scale, pages, pageFromScroll]);

  const zoomBy = (factor: number) => {
    if (scale === null) return;
    setZoom({ mode: 'custom', scale: clamp(scale * factor, WORD_SCALE.min, WORD_SCALE.max) });
  };

  // Before the document is drawn the frame fills the well (transparent); after, it takes the
  // document's scaled size. The frame element never moves in the tree, so it never reloads.
  const sheetStyle: CSSProperties | undefined =
    natural && scale !== null
      ? { width: Math.floor(natural.width * scale), height: Math.ceil(natural.height * scale) }
      : box
        ? { width: box.width, height: box.height }
        : undefined;

  const toolbar = (
    <>
      <PageControl page={page} total={pages?.length ?? null} ready={ready} onGo={goToPage} />
      <SearchToggle search={search} ready={ready} />
      <div className="ar-mv__group">
        <ToolButton
          label={UI.viewers.zoomOut}
          onClick={() => zoomBy(1 / ZOOM_STEP)}
          disabled={!ready || scale === null || scale <= WORD_SCALE.min + 0.001}
        >
          <Icon icon={ZoomOut} size={18} />
        </ToolButton>
        <ToolButton
          label={UI.viewers.zoomIn}
          onClick={() => zoomBy(ZOOM_STEP)}
          disabled={!ready || scale === null || scale >= WORD_SCALE.max - 0.001}
        >
          <Icon icon={ZoomIn} size={18} />
        </ToolButton>
        <ToolButton
          label={UI.viewers.document.fitWidth}
          onClick={() => setZoom({ mode: 'width' })}
          disabled={!ready}
          pressed={ready && zoom.mode === 'width'}
        >
          <Icon icon={MoveHorizontal} size={18} />
        </ToolButton>
      </div>
      <SearchRow search={search} ready={ready} />
      <p className={styles.note}>{UI.viewers.document.wordNotice}</p>
    </>
  );

  return (
    <ViewerFrame
      label={label}
      kind={UI.viewers.kind.document}
      aspect={DOCUMENT_ASPECT}
      caption={caption}
      fileName={media.file.name}
      description={media.alt || undefined}
      downloads={[{ file: media.file }]}
      toolbar={toolbar}
    >
      <div ref={hostRef} className="absolute inset-0">
        {(!natural || failed) && <ReaderPoster media={media} waitingForTap={requiresTap && !active} wellAspect={DOCUMENT_ASPECT} />}
        {live && (
          <ReaderScroller ref={scrollerRef} label={label} onScroll={onScroll}>
            <div className={styles.stage}>
              <div ref={sheetRef} className={styles.sheet} style={sheetStyle}>
                <iframe
                  ref={frameRef}
                  src={FRAME_SRC}
                  sandbox="allow-scripts"
                  title={label}
                  tabIndex={-1}
                  referrerPolicy="no-referrer"
                  onLoad={() => setFrameLoaded(true)}
                  className={styles.frame}
                  style={{ width: '100%', height: '100%', visibility: natural ? undefined : 'hidden' }}
                />
              </div>
            </div>
          </ReaderScroller>
        )}
        {requiresTap && !active && (
          <TapToLoad
            label={UI.viewers.document.open}
            icon={<Icon icon={FileText} size={18} />}
            onActivate={() => {
              setTapped(true);
              activate();
            }}
          />
        )}
        {live && !natural && <WellNotice>{UI.viewers.loading}</WellNotice>}
        {failed && <WellNotice>{failureText(media.file)}</WellNotice>}
      </div>
    </ViewerFrame>
  );
}
