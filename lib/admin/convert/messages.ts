/**
 * The words the owner reads when the admin prepares an upload (ARCHITECTURE.md 13A; docs/V3_PLAN.md
 * D-24, D-28, D-30, D-81, Q-20 to Q-22): refusals, failures, and the warnings shown before a file
 * is stored. They state no fact about the owner. They live here, beside the conversion code, as
 * lib/storage/labels.ts does for the storage adapter, because lib/strings.ts has no admin keys.
 *
 * A value taken from a file (a name, a codec) is shortened before it is quoted.
 */

/** A value from a file, made safe to quote: printable characters only, at most 80 of them. */
function quoted(value: string): string {
  const clean = value.replace(/[^\x20-\x7e]/g, '?');
  return `"${clean.length > 80 ? `${clean.slice(0, 77)}...` : clean}"`;
}

/** At most five quoted values, then how many more there are. */
function quotedList(values: readonly string[]): string {
  const shown = values.slice(0, 5).map(quoted).join(', ');
  return values.length > 5 ? `${shown}, and ${values.length - 5} more` : shown;
}

/**
 * Page numbers as few words: "page 2", "pages 2 and 3", "pages 2 to 4", "pages 2, 5, and 7 to 9".
 * Runs of three pages or more become ranges; after twelve items the other pages are counted.
 */
export function pageList(pages: readonly number[]): string {
  const sorted = [...new Set(pages)].filter((page) => Number.isInteger(page) && page > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return '';
  const items: { text: string; count: number }[] = [];
  for (let start = 0; start < sorted.length; ) {
    let end = start;
    while (end + 1 < sorted.length && sorted[end + 1] === sorted[end] + 1) end += 1;
    if (end - start >= 2) items.push({ text: `${sorted[start]} to ${sorted[end]}`, count: end - start + 1 });
    else for (let i = start; i <= end; i += 1) items.push({ text: `${sorted[i]}`, count: 1 });
    start = end + 1;
  }
  const words = items.slice(0, 12).map((item) => item.text);
  const rest = items.slice(12).reduce((sum, item) => sum + item.count, 0);
  if (rest > 0) words.push(`${rest} more`);
  const noun = sorted.length === 1 ? 'page' : 'pages';
  if (words.length === 1) return `${noun} ${words[0]}`;
  if (words.length === 2) return `${noun} ${words[0]} and ${words[1]}`;
  return `${noun} ${words.slice(0, -1).join(', ')}, and ${words[words.length - 1]}`;
}

/** A library's own error text, shortened, so a failure says what went wrong without a wall of text. */
export function detailOf(error: unknown): string {
  const text = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return 'no reason was given';
  return clean.length > 200 ? `${clean.slice(0, 197)}...` : clean;
}

export const CONVERT_MESSAGES = {
  // -------------------------------------------------------------------------------------------
  // Refusals, before any conversion
  // -------------------------------------------------------------------------------------------
  emptyFile: 'This file is empty.',
  refusedExtension: (ext: string) =>
    `Files ending in .${ext} cannot be uploaded: a page, a script, or XML could run code on the site.`,
  refusedMarkup: 'This file is a web page or XML, which could run code on the site, so it cannot be uploaded.',
  refusedProgram: 'This file is a program or a script, which cannot be uploaded.',
  unknownType: 'The type of this file could not be recognized from its contents, so it cannot be uploaded.',
  unsupportedType: (label: string, hint: string) => `${label} files cannot be uploaded.${hint ? ` ${hint}` : ''}`,
  unsupportedExtension: (ext: string) => `Files ending in .${ext} cannot be uploaded.`,
  legacyOffice: (ext: string) =>
    `Old .${ext} files cannot be uploaded. Save it as ${ext === 'doc' ? 'DOCX' : ext === 'xls' ? 'XLSX' : 'PPTX'} or PDF and upload that.`,
  companionAlone: (name: string) =>
    `${quoted(name)} is part of a 3D model. Drop it together with the model file (.gltf or .obj) that uses it.`,
  officeMacros: 'This office file contains macros, which cannot be uploaded. Save a copy without macros and upload that.',

  hintPhoto: 'Export it as JPEG or PNG and upload that.',
  hintVideo: 'Export it as H.264 MP4 and upload that.',
  hintAudio: 'Export it as MP3, M4A, or WAV and upload that.',
  hintArchive: 'Only .zip archives can be uploaded.',
  hintModel: 'Export it as GLB, glTF 2.0, STL, OBJ, 3MF, PLY, or STEP and upload that.',

  // -------------------------------------------------------------------------------------------
  // Photos
  // -------------------------------------------------------------------------------------------
  imageUnreadable: 'This image could not be read. Export it again as JPEG or PNG and upload that.',
  heicUnreadable: 'This HEIC photo could not be read in this browser. Export it as JPEG and upload that.',
  webpFailed: 'This browser could not encode the photo as WebP.',
  animationDropped: 'This image is animated. Only its first frame is kept, as a still WebP image.',

  // -------------------------------------------------------------------------------------------
  // Video
  // -------------------------------------------------------------------------------------------
  videoUnreadable: 'This video could not be read. Export it as H.264 MP4 and upload that.',
  videoNoTrack: 'This file has no video track.',
  videoCodec: (codec: string) =>
    `This video uses ${quoted(codec)}, which browsers cannot play. Export it as H.264 MP4 and upload that.`,
  videoRemuxFailed: (detail: string) => `This video could not be re-wrapped as MP4 (${detail}).`,
  hevc: 'This video is H.265 (HEVC), which most browsers other than Safari cannot play. Export it as H.264 MP4 if you can.',
  webmMetadata:
    'This WebM file carries details such as a title or a date, which cannot be removed in the browser and stay in the file. Upload it only if they may be public.',
  soundConverted: 'The sound track was converted to AAC, so that browsers can play it.',
  soundDropped:
    'The sound of this video cannot be converted here, so it would be stored silent. Export it as H.264 MP4 with AAC sound to keep the sound.',
  noVideoPoster: 'No poster frame could be taken from this video in this browser, so it has no poster.',

  // -------------------------------------------------------------------------------------------
  // Audio
  // -------------------------------------------------------------------------------------------
  audioUnreadable: 'This audio file could not be read. Export it as MP3 or M4A and upload that.',
  audioNoTrack: 'This file has no sound track.',
  aacUnavailable: 'This browser could not convert the WAV file to AAC. Export it as M4A or MP3 and upload that.',
  audioMetadata:
    'This audio file carries details such as a title, a name, or a date, which stay in the file. Upload it only if they may be public.',
  noWaveform: 'The waveform could not be computed in this browser, so the player shows a plain progress bar.',

  // -------------------------------------------------------------------------------------------
  // Documents
  // -------------------------------------------------------------------------------------------
  pdfUnreadable: 'This PDF could not be read.',
  pdfPassword: 'This PDF is protected by a password. Save a copy without the password and upload that.',
  docxUnreadable: 'This Word file could not be read.',
  textUnreadable: 'The text of this document could not be read, so the content check cannot see it.',
  pagesUnreadable: (pages: readonly number[]) =>
    `No text could be read on ${pageList(pages)} (a scanned page has none), so the content check cannot see the words there.`,
  docxTooLarge:
    'This Word file is larger than 50 MB, the most the browser reads for the content check. Save it as PDF and upload that.',
  docxPartsUnreadable: (parts: readonly string[]) =>
    `Parts of this document could not be read for the content check: ${quotedList(parts)}. They hold embedded files or other data that is not text, and they are published with the file. Upload it only if they may be public.`,
  officeTextUnchecked: 'The text inside this file is not read in the browser, so the content check cannot see it.',
  archiveUnchecked: 'The files inside this archive are not read, so the content check sees only their names.',
  noDocumentPoster: 'The first page could not be drawn, so this document has no poster.',

  // -------------------------------------------------------------------------------------------
  // Captions
  // -------------------------------------------------------------------------------------------
  vttInvalid: 'This captions file does not start with WEBVTT, so it is not a WebVTT file.',

  // -------------------------------------------------------------------------------------------
  // 3D models
  // -------------------------------------------------------------------------------------------
  modelUnreadable: (detail: string) => `This model could not be read (${detail}).`,
  modelEmpty: 'This model has no geometry to show.',
  modelExportFailed: (detail: string) => `This model could not be converted to GLB (${detail}).`,
  modelCheckFailed: (detail: string) =>
    `The converted model could not be loaded back by the site's viewer, so it was not kept (${detail}).`,
  modelMissingFile: (name: string) =>
    `The model refers to ${quoted(name)}, which was not dropped with it. That part is left out.`,
  modelMissingFiles: (names: string[]) =>
    `This model needs ${names.slice(0, 5).map(quoted).join(', ')}, which ${names.length === 1 ? 'was' : 'were'} not dropped with it. Drop the model together with all its files.`,
  modelSimplified: (before: number, after: number) =>
    `This model had ${before.toLocaleString('en-US')} triangles and was simplified to ${after.toLocaleString('en-US')}.`,
  modelStillLarge: (count: number) =>
    `This model still has ${count.toLocaleString('en-US')} triangles, which may be slow on phones.`,
  noModelPoster: 'No poster could be drawn for this model in this browser, so it has no poster.',
  modelTooLarge:
    'This model is larger than 150 MB (with the files it uses), the most the browser converter takes. Export a smaller GLB or STL and upload that.',
  stepTooLarge:
    'This STEP file is larger than 50 MB, the most the browser converter takes. Export it as GLB or STL from your CAD tool and upload that.',
  stepTimeout:
    'This STEP file is too complex to convert in the browser. Export it as GLB or STL from your CAD tool and upload that.',
  stepUnreadable: 'This STEP file could not be read. Export it as GLB or STL from your CAD tool and upload that.',
  stepBlocked:
    'The STEP converter could not start in this browser. Export the model as GLB or STL from your CAD tool and upload that.',

  // -------------------------------------------------------------------------------------------
  // Anything else
  // -------------------------------------------------------------------------------------------
  failed: (detail: string) => `This file could not be prepared for upload (${detail}).`,
} as const;
