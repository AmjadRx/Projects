/**
 * Names that read like a resume or a CV (ARCHITECTURE.md 4: "No resume file is ever served by the
 * site"), in a link, a path, or a file name: as a person names a file, and as the admin stores an
 * upload. lib/storage/rules.ts sanitizeFileName lowercases a name, drops its accents, and joins its
 * words with hyphens or with nothing, so "AmjadRehawiResume.pdf" is stored as
 * amjadrehawiresume.pdf, "MyCV.pdf" as mycv.pdf, and "Résumé 2026.pdf" as resume-2026.pdf.
 *
 * - "resume" (accents or none, percent-encoded or not) and "curriculum vitae" anywhere;
 * - "cv", "vita" and "vitae" as words of their own;
 * - in a document's own name (a PDF, a Word file, ...), "cv" glued to the words before it
 *   (mycv.pdf, amjadcv2026.pdf), where no other word can end in it.
 */

/** The kinds of file a resume is sent as. */
const DOCUMENT = /\.(pdf|docx?|odt|rtf|pages|txt|md)$/;

/** The name as it reads: percent-encoding undone, accents dropped, lowercase. */
function plain(name: string): string {
  let text = name;
  try {
    text = decodeURIComponent(name);
  } catch {
    // Not percent-encoded as a whole: read as it is.
  }
  return text.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function namedLikeResume(name: string): boolean {
  const text = plain(name);
  if (/resume|curriculum[^a-z]*vitae|(^|[^a-z])(cv|vitae?)([^a-z]|$)/.test(text)) return true;
  const file = text.split('/').pop() ?? '';
  const dot = file.lastIndexOf('.');
  return dot > 0 && DOCUMENT.test(file) && /cv(?![a-z])/.test(file.slice(0, dot));
}
