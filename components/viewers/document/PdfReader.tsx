'use client';

import dynamic from 'next/dynamic';
import { FileText, MoveHorizontal, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import Icon from '@/components/sheet/Icon';
import type { ResolvedMedia } from '@/lib/media';
import { UI } from '@/lib/strings';
import TapToLoad from '../shared/TapToLoad';
import ViewerErrorBoundary from '../shared/ViewerErrorBoundary';
import ViewerFrame from '../shared/ViewerFrame';
import { failureText } from '../shared/DownloadLink';
import { useDocumentVisible } from '../shared/hooks';
import { useViewerActivation } from '../shared/useViewerActivation';
import {
  FailSignal,
  PageControl,
  ReaderPoster,
  SearchRow,
  SearchToggle,
  ToolButton,
  WellNotice,
} from './ReaderParts';
import { clamp, PDF_SCALE, ZOOM_STEP, type PdfScaleInfo, type PdfSearch, type PdfZoom } from './reader-types';
import type { SearchMatch } from './search';
import { useReaderSearch } from './useReaderSearch';

/** pdf.js and react-pdf load only when the reader is in view, or on a tap (ARCHITECTURE.md 13A). */
const PdfEngine = dynamic(() => import('./PdfEngine'), { ssr: false, loading: () => null });

/** The reader's well (bundle DocumentReader): 4:3, the first page contained in it as the poster. */
const DOCUMENT_ASPECT = 4 / 3;

export default function PdfReader({ media, label, caption }: { media: ResolvedMedia; label: string; caption?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const { active, requiresTap, activate } = useViewerActivation(hostRef, 'view-or-tap');
  const visible = useDocumentVisible();
  const [tapped, setTapped] = useState(false);
  const [failed, setFailed] = useState(false);
  const [drawn, setDrawn] = useState(false);
  const [numPages, setNumPages] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState<PdfZoom>({ mode: 'page' });
  const [scaleInfo, setScaleInfo] = useState<PdfScaleInfo | null>(null);

  const ready = active && !failed && numPages !== null;

  // ---------------------------------------------------------------------------------------------
  // Engine events (stable handlers: the engine keeps them in a ref).
  const searchRef = useRef<PdfSearch | null>(null);
  const onLoad = useCallback((info: { numPages: number; search: PdfSearch }) => {
    searchRef.current = info.search;
    setNumPages(info.numPages);
    setPage((current) => clamp(current, 1, info.numPages));
  }, []);
  const onFail = useCallback(() => setFailed(true), []);
  const onFirstRender = useCallback(() => setDrawn(true), []);
  const onScale = useCallback((info: PdfScaleInfo) => setScaleInfo(info), []);
  const numPagesRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    numPagesRef.current = numPages;
  }, [numPages]);
  const onNavigate = useCallback((target: number) => {
    const total = numPagesRef.current;
    if (total) setPage(clamp(Math.round(target), 1, total));
  }, []);

  // ---------------------------------------------------------------------------------------------
  // Pages.
  const goTo = useCallback(
    (target: number) => {
      if (numPages && Number.isFinite(target)) setPage(clamp(Math.round(target), 1, numPages));
    },
    [numPages],
  );

  // ---------------------------------------------------------------------------------------------
  // Zoom.
  const scale = scaleInfo?.scale;
  const zoomBy = (factor: number) => {
    if (scale === undefined) return;
    setZoom({ mode: 'custom', scale: clamp(scale * factor, PDF_SCALE.min, PDF_SCALE.max) });
  };
  const canZoomIn = ready && scale !== undefined && scale < PDF_SCALE.max - 0.001;
  const canZoomOut = ready && scale !== undefined && scale > PDF_SCALE.min + 0.001;

  // ---------------------------------------------------------------------------------------------
  // Search across every page: the engine reads the text, highlights the matches, and scrolls the
  // current one into view; choosing a match turns to its page.
  const searchPdf = useCallback(
    (query: string): Promise<SearchMatch[]> => searchRef.current?.(query) ?? Promise.resolve([]),
    [],
  );
  const selectMatch = useCallback((match: SearchMatch) => setPage(match.page), []);
  const search = useReaderSearch<SearchMatch>({
    enabled: numPages !== null,
    page,
    search: searchPdf,
    onSelect: selectMatch,
  });

  // ---------------------------------------------------------------------------------------------
  const toolbar = (
    <>
      <PageControl page={page} total={numPages} ready={ready} onGo={goTo} />
      <SearchToggle search={search} ready={ready} />

      {/* Zoom: out, in, fit width, and back to the whole page. */}
      <div className="ar-mv__group">
        <ToolButton label={UI.viewers.zoomOut} onClick={() => zoomBy(1 / ZOOM_STEP)} disabled={!canZoomOut}>
          <Icon icon={ZoomOut} size={18} />
        </ToolButton>
        <ToolButton label={UI.viewers.zoomIn} onClick={() => zoomBy(ZOOM_STEP)} disabled={!canZoomIn}>
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
        <ToolButton label={UI.viewers.resetView} onClick={() => setZoom({ mode: 'page' })} disabled={!ready || zoom.mode === 'page'}>
          <Icon icon={RotateCcw} size={18} />
        </ToolButton>
      </div>

      <SearchRow search={search} ready={ready} />
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
        {(!drawn || failed) && <ReaderPoster media={media} waitingForTap={requiresTap && !active} wellAspect={DOCUMENT_ASPECT} />}
        {active && !failed && (
          <ViewerErrorBoundary fallback={<FailSignal onFail={onFail} />}>
            <PdfEngine
              src={media.file.src}
              label={label}
              page={page}
              zoom={zoom}
              matches={search.matches}
              current={search.current}
              autoFocus={tapped}
              visible={visible}
              onLoad={onLoad}
              onScale={onScale}
              onFirstRender={onFirstRender}
              onFail={onFail}
              onNavigate={onNavigate}
            />
          </ViewerErrorBoundary>
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
        {active && !drawn && !failed && <WellNotice>{UI.viewers.loading}</WellNotice>}
        {failed && <WellNotice>{failureText(media.file)}</WellNotice>}
      </div>
    </ViewerFrame>
  );
}
