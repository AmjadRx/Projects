/**
 * Reading the PDF Chrome prints (page.pdf) for the print checks (tests/e2e/print.spec.ts): its
 * pages, each page's size in points, and each page's text, through pdf.js (pdfjs-dist, which the
 * site's document viewer already depends on through react-pdf; its legacy build runs in Node).
 */

export interface PrintedPdf {
  pages: number;
  /** Each page's width and height in points (1/72 in): US Letter landscape is 792 by 612. */
  sizes: [number, number][];
  /** Each page's text, its pieces joined by spaces. */
  text: string[];
}

interface PdfJs {
  getDocument(options: Record<string, unknown>): { promise: Promise<PdfDocument> };
}
interface PdfDocument {
  numPages: number;
  getPage(n: number): Promise<{ view: number[]; getTextContent(): Promise<{ items: { str?: string }[] }> }>;
  destroy(): Promise<void>;
}

export async function readPdf(file: Buffer): Promise<PrintedPdf> {
  const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as unknown as PdfJs;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(file), isEvalSupported: false, disableFontFace: true, verbosity: 0 }).promise;
  try {
    const sizes: [number, number][] = [];
    const text: string[] = [];
    for (let n = 1; n <= doc.numPages; n += 1) {
      const page = await doc.getPage(n);
      const [x0, y0, x1, y1] = page.view;
      sizes.push([Math.round(x1 - x0), Math.round(y1 - y0)]);
      const content = await page.getTextContent();
      text.push(content.items.map((item) => item.str ?? '').join(' '));
    }
    return { pages: doc.numPages, sizes, text };
  } finally {
    await doc.destroy();
  }
}

/**
 * Text for comparing with a PDF's: letters and digits only, in lower case. pdf.js splits a line
 * into pieces at kerning and gives a mark its own piece, so spaces and punctuation are not kept.
 */
export function letters(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}
