'use client';

import { UI } from '@/lib/strings';
import { captionLine } from '../shared/caption';
import type { DocumentViewerProps } from '../types';
import PdfReader from './PdfReader';
import WordReader from './WordReader';

/**
 * The document reader (ARCHITECTURE.md 13A, DESIGN_DIRECTION.md 11): PDF through pdf.js with
 * page turning, zoom, and search; Word inside an isolated frame with zoom. Both paint the poster
 * (the first page) first, load their engine only in view on a desktop or on a tap on a phone,
 * and keep the plain download link under the well.
 *
 * `title` is the document's name: it names the viewer and leads the caption line. `media.alt`
 * is the text alternative, read by assistive technology.
 */
export default function DocumentViewer({ media, title, docType }: DocumentViewerProps) {
  const name = title?.trim() || undefined;
  const label = name ?? UI.viewers.document.documentFallback;
  const caption = captionLine(name, media.caption);
  return docType === 'docx' ? (
    <WordReader media={media} label={label} caption={caption} />
  ) : (
    <PdfReader media={media} label={label} caption={caption} />
  );
}
