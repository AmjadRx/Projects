/**
 * Files stored as they are (ARCHITECTURE.md 13A; docs/V3_PLAN.md D-24, D-28): SVG drawings (the
 * server sanitizes them), WebVTT captions, office files other than Word, and plain data (CSV,
 * text, zip). Nothing here converts bytes; each gives the content check the words it can read.
 */
import type { Detected } from './detect';
import { CONVERT_MESSAGES as M } from './messages';
import { isWebVtt, joinText, svgSize, svgText, vttCueText } from './text';
import { PrepareError, type PreparedUpload } from './types';
import { contentTypeFor, originalOf, outputName, type PrepareContext } from './util';
import { zipEntryNamesOf } from './zip';

/** The most text read from a CSV or text file for the content check. */
const TEXT_READ_MAX = 8 * 1024 * 1024;

function main(file: File, ext: string): PreparedUpload['parts'][number] {
  const contentType = contentTypeFor(ext);
  return { role: 'main', name: outputName(file.name, ext), blob: new Blob([file], { type: contentType }), contentType };
}

/** An SVG drawing: kept as uploaded (the server sanitizes it), with its words for the check. */
export async function prepareDrawing(file: File, context: PrepareContext): Promise<PreparedUpload> {
  context.progress('text');
  const source = await file.text();
  const size = svgSize(source);
  return {
    kind: 'drawing',
    mediaKind: 'image',
    original: originalOf(file),
    parts: [main(file, 'svg')],
    meta: { ...(size ?? {}), text: svgText(source) },
    warnings: context.warnings,
  };
}

/** A WebVTT captions file: it must start with WEBVTT; its cue text goes to the check. */
export async function prepareCaptions(file: File, context: PrepareContext): Promise<PreparedUpload> {
  context.progress('text');
  const source = await file.text();
  if (!isWebVtt(source)) throw new PrepareError('vtt-invalid', file.name, M.vttInvalid);
  return {
    kind: 'captions',
    mediaKind: null,
    original: originalOf(file),
    parts: [main(file, 'vtt')],
    meta: { text: vttCueText(source) ?? '' },
    warnings: context.warnings,
  };
}

/** An office file other than Word: a download, its name the only text the check reads. */
export async function prepareOffice(file: File, detected: Detected, context: PrepareContext): Promise<PreparedUpload> {
  context.warn('text-unreadable', M.officeTextUnchecked, true);
  return {
    kind: 'office',
    mediaKind: null,
    original: originalOf(file),
    parts: [main(file, detected.ext)],
    meta: { text: file.name },
    warnings: context.warnings,
  };
}

/** CSV, text, and zip files: downloads. Text files give their words, archives their entry names. */
export async function prepareFile(file: File, detected: Detected, context: PrepareContext): Promise<PreparedUpload> {
  context.progress('text');
  let text = file.name;
  if (detected.format === 'zip') {
    const entries = (await zipEntryNamesOf(file)) ?? [];
    text = joinText([file.name, ...entries]);
    context.warn('archive-unchecked', M.archiveUnchecked, true);
  } else {
    const body = await (file.size > TEXT_READ_MAX ? file.slice(0, TEXT_READ_MAX) : file).text();
    text = joinText([file.name, body]);
    if (file.size > TEXT_READ_MAX) context.warn('text-unreadable', M.textUnreadable, true);
  }
  return {
    kind: 'file',
    mediaKind: null,
    original: originalOf(file),
    parts: [main(file, detected.ext)],
    meta: { text },
    warnings: context.warnings,
  };
}
