/**
 * Documents (ARCHITECTURE.md 13A; docs/V3_PLAN.md D-24, D-28). PDF and Word files are stored as
 * they are; what this module adds is their words for the content check and, for a PDF, a poster.
 *
 * PDF: pdf.js (the copy react-pdf pins, with its worker from /vendor/pdfjs/) reads the text of
 * every page, the link addresses, the outline, and the document properties, and draws page 1
 * about 1600 px wide as the WebP poster. Every page with no text (a scan) or whose text could not
 * be read is named in a warning the owner must confirm, because the check cannot see its words.
 *
 * Word: JSZip opens every part of the file (at most 50 MB, read on the page): the body, headers
 * and footers, notes, comments, the glossary, charts, SmartArt, data parts, the authors and alt
 * text held in attributes, deleted text, link addresses, and the document properties. Pictures
 * and fonts are not read; embedded files and any other part that is not text are named in a
 * warning the owner must confirm. The file is never rendered here (D-28), and it has no poster:
 * the viewer shows a placeholder.
 */
import { textOf } from './detect';
import { CONVERT_MESSAGES as M } from './messages';
import { docxPartRole, docxWords, joinText, type DocxPart } from './text';
import { PrepareError, type PreparedPart, type PreparedUpload } from './types';
import {
  abortable,
  DOCUMENT_POSTER_WIDTH,
  DOCX_MAX_BYTES,
  isAbortError,
  originalOf,
  outputName,
  POSTER_QUALITY,
  posterName,
  readBytes,
  throwIfAborted,
  type PrepareContext,
} from './util';
import { createRaster, encodeWebP, releaseRaster } from './webp';

/** The same options the site's PDF reader uses (components/viewers/document/PdfEngine.tsx). */
const PDF_ASSETS = {
  workerSrc: '/vendor/pdfjs/pdf.worker.min.mjs',
  wasmUrl: '/vendor/pdfjs/wasm/',
  iccUrl: '/vendor/pdfjs/iccs/',
  cMapUrl: '/vendor/pdfjs/cmaps/',
};

const INFO_KEYS = ['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer'] as const;

/** String values of an object, nested lists included (an outline's titles, XMP values). */
function strings(value: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > 32) return out;
  if (typeof value === 'string') {
    if (value.trim()) out.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) strings(item, out, depth + 1);
  } else if (value instanceof Map) {
    for (const item of value.values()) strings(item, out, depth + 1);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) strings(item, out, depth + 1);
  }
  return out;
}

interface OutlineItem {
  title?: string;
  url?: string | null;
  items?: OutlineItem[];
}

function outlineText(items: OutlineItem[] | null | undefined, out: string[] = [], depth = 0): string[] {
  if (!items || depth > 32) return out;
  for (const item of items) {
    if (item.title) out.push(item.title);
    if (item.url) out.push(item.url);
    outlineText(item.items, out, depth + 1);
  }
  return out;
}

/** Prepares a PDF: the file as it is, its words, its page count, and a poster of page 1. */
export async function preparePdf(file: File, context: PrepareContext): Promise<PreparedUpload> {
  context.progress('decode');
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = PDF_ASSETS.workerSrc;
  const task = pdfjs.getDocument({
    data: await readBytes(file),
    isEvalSupported: false,
    useSystemFonts: true,
    enableXfa: false,
    verbosity: pdfjs.VerbosityLevel.ERRORS,
    wasmUrl: PDF_ASSETS.wasmUrl,
    iccUrl: PDF_ASSETS.iccUrl,
    cMapUrl: PDF_ASSETS.cMapUrl,
    cMapPacked: true,
  });
  context.cleanup.add(() => void task.destroy());

  let pdf: Awaited<typeof task.promise>;
  try {
    pdf = await abortable(task.promise, context.signal);
  } catch (error) {
    if (isAbortError(error, context.signal)) throw error;
    if (error instanceof Error && error.name === 'PasswordException') {
      throw new PrepareError('pdf-password', file.name, M.pdfPassword);
    }
    throw new PrepareError('pdf-unreadable', file.name, M.pdfUnreadable);
  }

  // Words: properties, outline, then every page's text and links.
  context.progress('text', 0);
  const extra: string[] = [];
  const pages: string[] = [];
  try {
    const metadata = await pdf.getMetadata();
    const info = (metadata.info ?? {}) as Record<string, unknown>;
    for (const key of INFO_KEYS) {
      const value = info[key];
      if (typeof value === 'string' && value.trim()) extra.push(value);
    }
    strings(info.Custom, extra);
    const xmp = metadata.metadata as { getAll?: () => unknown } | null;
    if (xmp?.getAll) strings(xmp.getAll(), extra);
  } catch {
    // Properties are optional.
  }
  try {
    outlineText((await pdf.getOutline()) as OutlineItem[] | null, extra);
  } catch {
    // So is the outline.
  }
  // Pages that give no text (a scan, a blank page) or whose text or notes could not be read.
  const unreadPages: number[] = [];
  for (let number = 1; number <= pdf.numPages; number += 1) {
    throwIfAborted(context.signal);
    let page: Awaited<ReturnType<typeof pdf.getPage>> | null = null;
    try {
      page = await pdf.getPage(number);
      const content = await page.getTextContent();
      const words = content.items
        .map((item) => ('str' in item ? `${item.str}${item.hasEOL ? '\n' : ' '}` : ''))
        .join('');
      pages.push(words);
      if (!words.trim()) unreadPages.push(number);
      for (const annotation of (await page.getAnnotations()) as Record<string, unknown>[]) {
        for (const key of ['url', 'unsafeUrl', 'fieldValue', 'alternativeText']) {
          const value = annotation[key];
          if (typeof value === 'string' && value.trim()) extra.push(value);
        }
        for (const key of ['contentsObj', 'titleObj']) {
          const value = (annotation[key] as { str?: unknown } | undefined)?.str;
          if (typeof value === 'string' && value.trim()) extra.push(value);
        }
      }
    } catch (error) {
      if (isAbortError(error, context.signal)) throw error;
      // The words of this page, or of its notes and links, are not all known.
      if (!unreadPages.includes(number)) unreadPages.push(number);
    } finally {
      page?.cleanup();
    }
    context.progress('text', number / pdf.numPages);
  }
  if (unreadPages.length > 0) {
    // One warning: the whole document, or the pages the check cannot see.
    context.warn('text-unreadable', unreadPages.length === pdf.numPages ? M.textUnreadable : M.pagesUnreadable(unreadPages), true);
  }
  const text = joinText([...pages.map((page) => page.trim()), ...Array.from(new Set(extra))]);

  // Poster: page 1, about 1600 px wide, on white.
  context.progress('poster');
  let poster: { blob: Blob; width: number; height: number } | null = null;
  try {
    const page = await pdf.getPage(1);
    const unscaled = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: DOCUMENT_POSTER_WIDTH / unscaled.width });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    await page.render({ canvas, viewport, background: 'white' }).promise;
    const raster = createRaster(canvas.width, canvas.height);
    try {
      raster.context.drawImage(canvas, 0, 0);
      poster = { blob: await encodeWebP(raster, { quality: POSTER_QUALITY }), width: canvas.width, height: canvas.height };
    } finally {
      releaseRaster(raster);
      canvas.width = 0;
      canvas.height = 0;
      page.cleanup();
    }
  } catch (error) {
    if (isAbortError(error, context.signal)) throw error;
    poster = null;
  }
  if (!poster) context.warn('no-poster', M.noDocumentPoster);

  const parts: PreparedPart[] = [
    { role: 'main', name: outputName(file.name, 'pdf'), blob: new Blob([file], { type: 'application/pdf' }), contentType: 'application/pdf' },
  ];
  if (poster) parts.push({ role: 'poster', name: posterName(file.name), blob: poster.blob, contentType: 'image/webp' });
  const pageCount = pdf.numPages;
  await pdf.destroy().catch(() => undefined);
  return {
    kind: 'document',
    mediaKind: 'document',
    original: originalOf(file),
    parts,
    meta: { ...(poster ? { width: poster.width, height: poster.height } : {}), pages: pageCount, text },
    warnings: context.warnings,
  };
}

const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Refuses a Word file over the 50 MB cap before anything is read: JSZip unpacks it on the page. */
export function checkDocxSize(file: { name: string; size: number }): void {
  if (file.size > DOCX_MAX_BYTES) throw new PrepareError('docx-too-large', file.name, M.docxTooLarge);
}

/** Prepares a Word file: the file as it is, and every word it holds for the check. */
export async function prepareDocx(file: File, context: PrepareContext): Promise<PreparedUpload> {
  checkDocxSize(file);
  context.progress('text', 0);
  const { default: JSZip } = await import('jszip');
  let zip: InstanceType<typeof JSZip>;
  try {
    zip = await JSZip.loadAsync(await file.arrayBuffer());
  } catch {
    throw new PrepareError('docx-unreadable', file.name, M.docxUnreadable);
  }
  throwIfAborted(context.signal);
  // Every part, in name order. Pictures, fonts, and embedded files are not unpacked.
  const entries = Object.values(zip.files)
    .filter((entry) => !entry.dir)
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
  const parts: DocxPart[] = [];
  let app = '';
  for (const [i, entry] of entries.entries()) {
    throwIfAborted(context.signal);
    const role = docxPartRole(entry.name);
    let text: string | null = null;
    if (role !== 'picture' && role !== 'font' && role !== 'embedded') {
      try {
        // UTF-8 or, with its byte order mark, UTF-16 (customXml items often are); null when not text.
        text = textOf(await entry.async('uint8array'));
      } catch {
        text = null; // a part that does not unpack
      }
    }
    if (role === 'properties' && /(?:^|\/)app\.xml$/i.test(entry.name)) app = text ?? '';
    parts.push({ name: entry.name, role, text });
    context.progress('text', (i + 1) / Math.max(1, entries.length));
  }
  const words = docxWords(parts);
  const pages = Number(/<Pages>(\d+)<\/Pages>/.exec(app)?.[1] ?? NaN);
  context.progress('text', 1);
  if (!words.body.trim()) context.warn('text-unreadable', M.textUnreadable, true);
  if (words.unread.length > 0) context.warn('parts-unreadable', M.docxPartsUnreadable(words.unread), true);
  return {
    kind: 'document',
    mediaKind: 'document',
    original: originalOf(file),
    parts: [{ role: 'main', name: outputName(file.name, 'docx'), blob: new Blob([file], { type: DOCX_TYPE }), contentType: DOCX_TYPE }],
    meta: { ...(Number.isInteger(pages) && pages > 0 ? { pages } : {}), text: words.text },
    warnings: context.warnings,
  };
}
