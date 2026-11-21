/**
 * Types shared by the document reader shells (PdfReader, WordReader) and the PDF engine, which
 * loads separately (next/dynamic) so pdf.js is never in a page's first-load JavaScript.
 */
import type { SearchMatch } from './search';

/** How a PDF page fills the well: the whole page, the full width, or a chosen scale. */
export type PdfZoom = { mode: 'page' } | { mode: 'width' } | { mode: 'custom'; scale: number };

/** How a Word document fills the well: the full width, or a chosen scale. */
export type WordZoom = { mode: 'width' } | { mode: 'custom'; scale: number };

/** One zoom step: in multiplies by this, out divides by it. */
export const ZOOM_STEP = 1.25;

/** Scale limits, in CSS pixels per PDF point (PDF) or per CSS pixel of the page (Word). */
export const PDF_SCALE = { min: 0.25, max: 5 } as const;
export const WORD_SCALE = { min: 0.2, max: 4 } as const;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** What the engine reports about the page it shows. */
export interface PdfScaleInfo {
  scale: number;
  fitPage: number;
  fitWidth: number;
}

/** Search across every page; resolves with the matches in reading order. */
export type PdfSearch = (query: string) => Promise<SearchMatch[]>;

export interface PdfEngineProps {
  /** The PDF's address. */
  src: string;
  /** Accessible name of the scrolling page area. */
  label: string;
  /** The page to show, from 1. */
  page: number;
  zoom: PdfZoom;
  /** Every match of the current search, and the index of the current one (-1 for none). */
  matches: readonly SearchMatch[];
  current: number;
  /** Move focus to the page area once it exists (after a tap on the load button). */
  autoFocus: boolean;
  /** False while the tab is hidden: background work (the search index) waits. */
  visible: boolean;
  onLoad: (info: { numPages: number; search: PdfSearch }) => void;
  onScale: (info: PdfScaleInfo) => void;
  /** The first page has been drawn: the poster may go. */
  onFirstRender: () => void;
  /** The file could not be read or drawn. */
  onFail: () => void;
  /** A link inside the PDF points at another page. */
  onNavigate: (page: number) => void;
}
