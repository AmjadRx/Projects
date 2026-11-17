'use client';

/**
 * The PDF engine: react-pdf (pdf.js) drawing one page at a time with its text layer (selection,
 * search highlights) and annotation layer (links). Loaded only through next/dynamic from
 * PdfReader, so none of this is in a page's first-load JavaScript.
 */
import 'react-pdf/dist/Page/TextLayer.css';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type Ref } from 'react';
import { Document, Page, pdfjs, type DocumentProps } from 'react-pdf';
import { cn } from '@/lib/utils';
import { ReaderScroller } from './ReaderParts';
import { clamp, PDF_SCALE, type PdfEngineProps } from './reader-types';
import { applyHighlights, findMatches, highlightsForPage, type PageText, type SearchMatch } from './search';
import styles from './reader.module.css';

/** Copied from the same pdfjs-dist version that react-pdf pins, by scripts/copy-vendor.mjs. */
pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';

/**
 * No string evaluation inside pdf.js, and system fonts in place of the standard-font files,
 * which the site does not ship (docs/V3_PLAN.md 4.2). The image decoders (JPEG 2000, color
 * profiles) and the character maps for CJK text are served from public/vendor/pdfjs/.
 */
const OPTIONS: NonNullable<DocumentProps['options']> = {
  isEvalSupported: false,
  useSystemFonts: true,
  enableXfa: false,
  verbosity: pdfjs.VerbosityLevel.ERRORS,
  wasmUrl: '/vendor/pdfjs/wasm/',
  iccUrl: '/vendor/pdfjs/iccs/',
  cMapUrl: '/vendor/pdfjs/cmaps/',
  cMapPacked: true,
};

/** The largest page canvas, in device pixels (4096 x 4096): deep zoom lowers sharpness, not memory. */
const MAX_CANVAS_PIXELS = 16_777_216;

type PdfDocument = Parameters<NonNullable<DocumentProps['onLoadSuccess']>>[0];

interface Size {
  width: number;
  height: number;
}

/** One drawing of one page at one scale. */
interface Layer {
  key: string;
  page: number;
  scale: number;
  dpr: number;
}

export default function PdfEngine(props: PdfEngineProps) {
  const { src, label, page, zoom, matches, current, autoFocus, visible } = props;

  // The latest callbacks, read inside the handlers given to react-pdf, so those handlers keep one
  // identity (its text layer redraws whenever a handler changes).
  const latest = useRef(props);
  useLayoutEffect(() => {
    latest.current = props;
  });

  const scrollerRef = useRef<HTMLDivElement>(null);
  const livePageRef = useRef<HTMLDivElement | null>(null);
  const pdfRef = useRef<PdfDocument | null>(null);
  const [pdf, setPdf] = useState<PdfDocument | null>(null);
  const [box, setBox] = useState<Size | null>(null);
  const [sizes, setSizes] = useState<ReadonlyMap<number, Size>>(() => new Map());
  const [displayPage, setDisplayPage] = useState<number | null>(null);
  const [drawn, setDrawn] = useState<Layer | null>(null);
  const [textKey, setTextKey] = useState<string | null>(null);
  const targetKeyRef = useRef<string | null>(null);
  const firstDraw = useRef(true);

  // ---------------------------------------------------------------------------------------------
  // The well's size, for the fit scales.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return undefined;
    const measure = () => {
      const next = { width: scroller.clientWidth, height: scroller.clientHeight };
      setBox((previous) => (previous && previous.width === next.width && previous.height === next.height ? previous : next));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, []);

  const focusOnce = useRef(autoFocus);
  useEffect(() => {
    if (focusOnce.current) scrollerRef.current?.focus({ preventScroll: true });
    focusOnce.current = false;
  }, []);

  // ---------------------------------------------------------------------------------------------
  // Search: every page's text, read once on the first search, and only while the tab is visible.
  const textRef = useRef<PageText[] | null>(null);
  const indexRef = useRef<Promise<PageText[]> | null>(null);
  const visibleRef = useRef(visible);
  const wakeRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    visibleRef.current = visible;
    if (visible && wakeRef.current) {
      wakeRef.current();
      wakeRef.current = null;
    }
  }, [visible]);

  const searchDocument = useCallback(async (query: string): Promise<SearchMatch[]> => {
    const doc = pdfRef.current;
    if (!doc) return [];
    if (!indexRef.current) {
      const whenVisible = () =>
        visibleRef.current
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              wakeRef.current = resolve;
            });
      indexRef.current = (async () => {
        const pages: PageText[] = [];
        for (let n = 1; n <= doc.numPages; n += 1) {
          await whenVisible();
          try {
            const proxy = await doc.getPage(n);
            const content = await proxy.getTextContent();
            const strs: string[] = [];
            const eols: boolean[] = [];
            for (const item of content.items) {
              const text = 'str' in item;
              strs.push(text ? item.str : '');
              eols.push(text ? item.hasEOL : false);
            }
            pages.push({ strs, eols });
          } catch {
            pages.push({ strs: [], eols: [] });
          }
        }
        textRef.current = pages;
        return pages;
      })();
    }
    return findMatches(await indexRef.current, query);
  }, []);

  // ---------------------------------------------------------------------------------------------
  // The document, and each page's size before it is drawn (so the scale is known first).
  const onLoadSuccess = useCallback(
    (doc: PdfDocument) => {
      pdfRef.current = doc;
      setPdf(doc);
      latest.current.onLoad({ numPages: doc.numPages, search: searchDocument });
    },
    [searchDocument],
  );

  const fail = useCallback(() => latest.current.onFail(), []);
  const onItemClick = useCallback(({ pageNumber }: { pageNumber: number }) => latest.current.onNavigate(pageNumber), []);

  useEffect(() => {
    if (!pdf || sizes.has(page) || page < 1 || page > pdf.numPages) return undefined;
    let cancelled = false;
    pdf.getPage(page).then(
      (proxy) => {
        if (cancelled) return;
        const viewport = proxy.getViewport({ scale: 1 });
        setSizes((previous) => new Map(previous).set(page, { width: viewport.width, height: viewport.height }));
      },
      () => {
        if (!cancelled) latest.current.onFail();
      },
    );
    return () => {
      cancelled = true;
    };
  }, [pdf, page, sizes]);

  useEffect(() => {
    if (sizes.has(page)) setDisplayPage(page);
  }, [page, sizes]);

  // ---------------------------------------------------------------------------------------------
  // The scale: the whole page, the full width, or the reader's choice.
  const size = displayPage === null ? undefined : sizes.get(displayPage);
  const fit = useMemo(() => {
    if (!box || !size || box.width <= 0 || box.height <= 0) return null;
    // Rounded down, so a fitted page never overflows the well by a pixel.
    const floor = (n: number) => Math.floor(n * 10000) / 10000;
    const fitWidth = floor(box.width / size.width);
    return { fitWidth, fitPage: Math.min(fitWidth, floor(box.height / size.height)) };
  }, [box, size]);

  const scale = useMemo(() => {
    if (!fit) return null;
    const wanted = zoom.mode === 'page' ? fit.fitPage : zoom.mode === 'width' ? fit.fitWidth : zoom.scale;
    return clamp(wanted, PDF_SCALE.min, PDF_SCALE.max);
  }, [fit, zoom]);

  useEffect(() => {
    if (scale !== null && fit) latest.current.onScale({ scale, ...fit });
  }, [scale, fit]);

  const target: Layer | null = useMemo(() => {
    if (displayPage === null || scale === null || !size) return null;
    const device = window.devicePixelRatio || 1;
    const area = size.width * scale * size.height * scale;
    const dpr = Math.max(0.5, Math.min(device, Math.sqrt(MAX_CANVAS_PIXELS / area)));
    return { key: `${displayPage}@${scale}`, page: displayPage, scale, dpr: Math.round(dpr * 100) / 100 };
  }, [displayPage, scale, size]);

  useLayoutEffect(() => {
    targetKeyRef.current = target?.key ?? null;
  }, [target]);

  const onDrawn = useCallback((layer: Layer) => {
    if (layer.key !== targetKeyRef.current) return;
    setDrawn(layer);
    if (firstDraw.current) {
      firstDraw.current = false;
      latest.current.onFirstRender();
    }
  }, []);

  const onTextDrawn = useCallback((key: string) => setTextKey(key), []);

  // The last finished drawing stays under the new one until it is ready: no blank flash.
  const backdrop = drawn && target && drawn.key !== target.key ? drawn : null;

  // ---------------------------------------------------------------------------------------------
  // Scrolling: a new page starts at its top. Zooming in or out keeps the same point in the
  // middle of the well; a fit (whole page, full width) keeps the top edge where it was.
  const lastScroll = useRef({ left: 0, top: 0 });
  const lastLayout = useRef<{ page: number; scale: number } | null>(null);
  const onScroll = useCallback(() => {
    const scroller = scrollerRef.current;
    if (scroller) lastScroll.current = { left: scroller.scrollLeft, top: scroller.scrollTop };
  }, []);

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || !target) return;
    const previous = lastLayout.current;
    lastLayout.current = { page: target.page, scale: target.scale };
    if (!previous) return;
    if (previous.page !== target.page) {
      scroller.scrollLeft = 0;
      scroller.scrollTop = 0;
    } else if (previous.scale !== target.scale) {
      const ratio = target.scale / previous.scale;
      const { left, top } = lastScroll.current;
      const halfWidth = latest.current.zoom.mode === 'custom' ? scroller.clientWidth / 2 : 0;
      const halfHeight = latest.current.zoom.mode === 'custom' ? scroller.clientHeight / 2 : 0;
      scroller.scrollLeft = Math.max(0, (left + halfWidth) * ratio - halfWidth);
      scroller.scrollTop = Math.max(0, (top + halfHeight) * ratio - halfHeight);
    }
    lastScroll.current = { left: scroller.scrollLeft, top: scroller.scrollTop };
  }, [target]);

  // The current match scrolls into view once: when it changes, after its page's text is drawn.
  const pendingScroll = useRef(false);
  useEffect(() => {
    pendingScroll.current = current >= 0;
  }, [current, matches]);

  useEffect(() => {
    if (!target || textKey !== target.key) return;
    const pageText = textRef.current?.[target.page - 1];
    const layer = livePageRef.current?.querySelector<HTMLElement>('.textLayer');
    if (!layer || !pageText) return;
    const mark = applyHighlights(layer, pageText, highlightsForPage(matches, target.page, current), {
      match: styles.match,
      current: styles.current,
    });
    const scroller = scrollerRef.current;
    if (!mark || !scroller || !pendingScroll.current) return;
    pendingScroll.current = false;
    const area = scroller.getBoundingClientRect();
    const spot = mark.getBoundingClientRect();
    const margin = 24;
    const outside =
      spot.top < area.top + margin || spot.bottom > area.bottom - margin || spot.left < area.left || spot.right > area.right;
    if (outside) {
      scroller.scrollLeft += spot.left - area.left - (area.width - spot.width) / 2;
      scroller.scrollTop += spot.top - area.top - (area.height - spot.height) / 2;
    }
  }, [textKey, target, matches, current]);

  // ---------------------------------------------------------------------------------------------
  const sheetSize =
    target && size ? { width: Math.floor(size.width * target.scale), height: Math.floor(size.height * target.scale) } : null;
  const backdropSize = backdrop ? sizes.get(backdrop.page) : undefined;

  return (
    <ReaderScroller ref={scrollerRef} label={label} onScroll={onScroll}>
      <div className={styles.stage}>
        <div className={styles.sheet} style={sheetSize ?? undefined}>
          <Document
            file={src}
            options={OPTIONS}
            onLoadSuccess={onLoadSuccess}
            onLoadError={fail}
            onSourceError={fail}
            onPassword={fail}
            onItemClick={onItemClick}
            externalLinkTarget="_blank"
            externalLinkRel="noopener noreferrer nofollow"
            loading={null}
            error={null}
            noData={null}
          >
            {backdrop && backdropSize && (
              <PageLayer
                key={backdrop.key}
                layer={backdrop}
                live={false}
                width={Math.floor(backdropSize.width * backdrop.scale)}
                height={Math.floor(backdropSize.height * backdrop.scale)}
                ratio={target && backdrop.page === target.page ? target.scale / backdrop.scale : 1}
                onDrawn={onDrawn}
                onTextDrawn={onTextDrawn}
                onFail={fail}
              />
            )}
            {target && sheetSize && (
              <PageLayer
                key={target.key}
                layer={target}
                live
                width={sheetSize.width}
                height={sheetSize.height}
                ratio={1}
                onDrawn={onDrawn}
                onTextDrawn={onTextDrawn}
                onFail={fail}
                pageRef={livePageRef}
              />
            )}
          </Document>
        </div>
      </div>
    </ReaderScroller>
  );
}

/**
 * One page drawing. The live one carries the text and link layers; a backdrop is the previous
 * drawing, stretched to the new scale until the live one is ready.
 */
function PageLayer({
  layer,
  live,
  width,
  height,
  ratio,
  onDrawn,
  onTextDrawn,
  onFail,
  pageRef,
}: {
  layer: Layer;
  live: boolean;
  width: number;
  height: number;
  ratio: number;
  onDrawn: (layer: Layer) => void;
  onTextDrawn: (key: string) => void;
  onFail: () => void;
  pageRef?: Ref<HTMLDivElement | null>;
}) {
  const { key, page, scale, dpr } = layer;
  const handleDrawn = useCallback(() => onDrawn({ key, page, scale, dpr }), [onDrawn, key, page, scale, dpr]);
  const handleText = useCallback(() => onTextDrawn(key), [onTextDrawn, key]);
  return (
    <div
      className={cn(styles.layer, !live && styles.backdrop)}
      style={{ width, height, transform: ratio !== 1 ? `scale(${ratio})` : undefined }}
      aria-hidden={live ? undefined : true}
    >
      <Page
        pageNumber={page}
        scale={scale}
        devicePixelRatio={dpr}
        className={styles.page}
        inputRef={live ? pageRef : undefined}
        renderTextLayer={live}
        renderAnnotationLayer={live}
        renderForms={false}
        onRenderSuccess={handleDrawn}
        onRenderError={onFail}
        onLoadError={onFail}
        onRenderTextLayerSuccess={handleText}
        loading={null}
        error={null}
        noData={null}
      />
    </div>
  );
}
