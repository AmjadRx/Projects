/**
 * The words the admin takes from documents for the content check (lib/admin/convert/document.ts
 * and text.ts), run for real under Node: JSZip for Word files, and pdf.js on its in-thread worker
 * for PDFs (the poster needs a canvas and is left out, as in a browser that cannot draw it).
 *
 * Regressions of the Phase 6 review: every part of a Word file and the words held in its
 * attributes reach the check, and parts that cannot be read are named (CONVERT-2); every PDF page
 * without readable text is named (CONVERT-3); a Word file over 50 MB is refused before it is read
 * (CONVERT-8).
 */
import JSZip from 'jszip';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { checkDocxSize, prepareDocx, preparePdf } from '@/lib/admin/convert/document';
import { CONVERT_MESSAGES as M, pageList } from '@/lib/admin/convert/messages';
import { docxPartRole, docxWords, officeAttributeText, officeXmlText } from '@/lib/admin/convert/text';
import { PrepareError } from '@/lib/admin/convert/types';
import { createContext, DOCX_MAX_BYTES } from '@/lib/admin/convert/util';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const NS = [
  W,
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"',
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"',
  'xmlns:v="urn:schemas-microsoft-com:vml"',
  'xmlns:o="urn:schemas-microsoft-com:office:office"',
].join(' ');

async function docxOf(parts: Record<string, string | Uint8Array>): Promise<File> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(parts)) zip.file(name, content);
  const bytes = new Uint8Array(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }));
  return new File([bytes], 'report.docx');
}

/** UTF-16LE with its byte order mark, as SharePoint writes customXml items. */
function utf16(text: string): Uint8Array {
  const out = new Uint8Array(2 + text.length * 2);
  out.set([0xff, 0xfe]);
  for (let i = 0; i < text.length; i += 1) {
    out[2 + i * 2] = text.charCodeAt(i) & 0xff;
    out[3 + i * 2] = text.charCodeAt(i) >> 8;
  }
  return out;
}

const PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
);
/** Bytes that are not text (a NUL in the first bytes). */
const BINARY = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 1, 2, 3]);

/** A team report whose names sit in every place a Word file keeps words. */
const REPORT: Record<string, string | Uint8Array> = {
  '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
  'word/document.xml':
    `<w:document ${NS}><w:body>` +
    '<w:p><w:r><w:t>Team report</w:t></w:r></w:p>' +
    // A tracked insertion: the author is an attribute.
    '<w:p><w:ins w:id="1" w:author="Zelda Quartermain" w:date="2026-10-01T00:00:00Z"><w:r><w:t>added line</w:t></w:r></w:ins></w:p>' +
    // A picture: its name (often the inserted file's), alt text, and title.
    '<w:p><w:r><w:drawing><wp:inline><wp:docPr id="1" name="IMG_2041 Ulysses.jpg" descr="Zelda at the bench, height &gt; 2 m" title="Bench photo"/></wp:inline></w:drawing></w:r></w:p>' +
    // A word split across runs, and a deletion inside a word: the text reads as shown.
    '<w:p><w:r><w:t>Signed by Quar</w:t></w:r><w:del w:id="2" w:author="A" w:date="d"><w:r><w:delText>xx</w:delText></w:r></w:del><w:r><w:rPr><w:b/></w:rPr><w:t>termain</w:t></w:r></w:p>' +
    // One deletion over several runs is kept whole.
    '<w:p><w:del w:id="3" w:author="A" w:date="d"><w:r><w:delText>Removed: Ulysses Bright</w:delText></w:r><w:r><w:rPr><w:i/></w:rPr><w:delText>water</w:delText></w:r></w:del></w:p>' +
    // A deleted paragraph mark is an empty marker, not a deletion of what follows.
    '<w:p><w:pPr><w:rPr><w:del w:id="4" w:author="A" w:date="d"/></w:rPr></w:pPr><w:r><w:t>Kept after the marker</w:t></w:r></w:p>' +
    '<w:p><w:hyperlink r:id="rId9" w:tooltip="Tooltip names Zelda"><w:r><w:t>link</w:t></w:r></w:hyperlink></w:p>' +
    '<w:p><w:fldSimple w:instr=" AUTHOR Zelda "><w:r><w:t>field result</w:t></w:r></w:fldSimple></w:p>' +
    '<w:p><w:r><w:pict><v:shape alt="VML alt text"><v:imagedata r:id="rId8" o:title="scan of Ulysses badge"/><v:textpath string="WordArt Zelda"/></v:shape></w:pict></w:r></w:p>' +
    '<w:sdt><w:sdtPr><w:alias w:val="Control titled Zelda"/><w:tag w:val="control tag"/></w:sdtPr><w:sdtContent><w:p><w:r><w:t>control text</w:t></w:r></w:p></w:sdtContent></w:sdt>' +
    '</w:body></w:document>',
  'word/_rels/document.xml.rels':
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId9" Type=".../hyperlink" Target="https://example.org/zelda" TargetMode="External"/></Relationships>',
  'word/comments.xml': `<w:comments ${W}><w:comment w:id="0" w:author="Zelda Quartermain" w:initials="ZQ"><w:p><w:r><w:t>Looks good</w:t></w:r></w:p></w:comment></w:comments>`,
  'word/people.xml':
    '<w15:people xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"><w15:person w15:author="Ulysses Brightwater"><w15:presenceInfo w15:providerId="AD" w15:userId="S::ulysses@example.edu::1234"/></w15:person></w15:people>',
  'word/footnotes.xml': `<w:footnotes ${W}><w:footnote w:id="1"><w:p><w:r><w:t>Footnote text</w:t></w:r></w:p></w:footnote></w:footnotes>`,
  'word/settings.xml': `<w:settings ${W}><w:docVars><w:docVar w:name="ClientName" w:val="Docvar Ulysses"/></w:docVars></w:settings>`,
  'word/glossary/document.xml': `<w:glossaryDocument ${W}><w:docParts><w:docPart><w:docPartPr><w:name w:val="Block by Zelda"/></w:docPartPr><w:docPartBody><w:p><w:r><w:t>AutoText by Zelda</w:t></w:r></w:p></w:docPartBody></w:docPart></w:docParts></w:glossaryDocument>`,
  // SmartArt: each box is its own line.
  'word/diagrams/data1.xml':
    '<dgm:dataModel xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><dgm:ptLst>' +
    '<dgm:pt modelId="1"><dgm:t><a:p><a:r><a:t>Organigram Ulysses Brightwater</a:t></a:r></a:p></dgm:t></dgm:pt>' +
    '<dgm:pt modelId="2"><dgm:t><a:p><a:r><a:t>Second box</a:t></a:r></a:p></dgm:t></dgm:pt>' +
    '</dgm:ptLst></dgm:dataModel>',
  // A chart: its title and its category labels, each value on its own line.
  'word/charts/chart1.xml':
    '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><c:chart>' +
    '<c:title><c:tx><c:rich><a:p><a:r><a:t>Hours by Ulysses Brightwater</a:t></a:r></a:p></c:rich></c:tx></c:title>' +
    '<c:plotArea><c:barChart><c:ser><c:cat><c:strRef><c:f>Sheet1!$A$2:$A$3</c:f><c:strCache><c:pt idx="0"><c:v>Zelda</c:v></c:pt><c:pt idx="1"><c:v>Quartermain</c:v></c:pt></c:strCache></c:strRef></c:cat></c:ser></c:barChart></c:plotArea>' +
    '</c:chart></c:chartSpace>',
  'word/charts/_rels/chart1.xml.rels':
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type=".../oleObject" Target="file:///C:/Users/zelda/Documents/hours.xlsx" TargetMode="External"/></Relationships>',
  'word/embeddings/Microsoft_Excel_Worksheet.xlsx': BINARY,
  'word/activeX/activeX1.bin': BINARY,
  'word/media/image1.png': PNG,
  'word/media/image2.svg': '<svg xmlns="http://www.w3.org/2000/svg"><text x="1" y="1">SVG label Zelda</text></svg>',
  'word/fonts/font1.odttf': BINARY,
  'customXml/item1.xml': utf16(
    '<?xml version="1.0" encoding="UTF-16"?><b:Sources xmlns:b="http://schemas.openxmlformats.org/officeDocument/2006/bibliography"><b:Source><b:Author><b:Author><b:NameList><b:Person><b:Last>Bibliography Last</b:Last><b:First>Bibliography First</b:First></b:Person></b:NameList></b:Author></b:Author></b:Source></b:Sources>',
  ),
  'docProps/core.xml':
    '<?xml version="1.0"?><cp:coreProperties xmlns:cp="x" xmlns:dc="y"><dc:creator>Creator Name</dc:creator><cp:lastModifiedBy>Zelda Q</cp:lastModifiedBy></cp:coreProperties>',
  'docProps/app.xml': '<?xml version="1.0"?><Properties><Pages>3</Pages><Company>Company Name</Company></Properties>',
  'docProps/custom.xml':
    '<?xml version="1.0"?><Properties xmlns:vt="z"><property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="Approver Ulysses"><vt:lpwstr>Custom value</vt:lpwstr></property></Properties>',
  'docProps/thumbnail.jpeg': BINARY,
};

describe('the words of every part of a Word file (CONVERT-2)', () => {
  it('hands the check the words of every part, attributes included', async () => {
    const prepared = await prepareDocx(await docxOf(REPORT), createContext('report.docx'));
    const text = prepared.meta.text ?? '';
    const lines = text.split('\n');
    for (const words of [
      'Team report',
      'added line',
      'Zelda Quartermain', // revision and comment author
      'ZQ', // comment initials
      'IMG_2041 Ulysses.jpg', // picture name
      'Zelda at the bench, height > 2 m', // alt text
      'Bench photo', // picture title
      'Signed by Quartermain', // split runs, deletion left out
      'xx', // the deleted text, apart
      'Removed: Ulysses Brightwater', // one deletion over two runs
      'Kept after the marker',
      'Tooltip names Zelda',
      'AUTHOR Zelda', // field code
      'VML alt text',
      'scan of Ulysses badge', // VML picture title
      'WordArt Zelda',
      'Control titled Zelda',
      'control tag',
      'control text',
      'https://example.org/zelda',
      'Looks good',
      'Ulysses Brightwater', // people.xml
      'S::ulysses@example.edu::1234',
      'Footnote text',
      'ClientName',
      'Docvar Ulysses',
      'Block by Zelda',
      'AutoText by Zelda',
      'Organigram Ulysses Brightwater',
      'Second box',
      'Hours by Ulysses Brightwater',
      'file:///C:/Users/zelda/Documents/hours.xlsx',
      'SVG label Zelda',
      'Bibliography Last',
      'Bibliography First',
      'Creator Name',
      'Zelda Q',
      'Company Name',
      'Approver Ulysses',
      'Custom value',
      'word/media/image1.png', // part names are words a downloader sees too
    ]) {
      expect(text).toContain(words);
    }
    // Chart values and SmartArt boxes stand alone, so names are never glued to the next one.
    expect(lines).toEqual(expect.arrayContaining(['Zelda', 'Quartermain', 'Organigram Ulysses Brightwater', 'Second box']));
    expect(text).not.toContain('ZeldaQuartermain');
    expect(text).not.toContain('Quarxxtermain');
    expect(text).not.toContain('Bibliography LastBibliography First');
    expect(prepared.meta.pages).toBe(3);
  });

  it('asks the owner before storing parts it could not read, and only those', async () => {
    const prepared = await prepareDocx(await docxOf(REPORT), createContext('report.docx'));
    expect(prepared.warnings).toEqual([
      {
        code: 'parts-unreadable',
        message: M.docxPartsUnreadable(['word/activeX/activeX1.bin', 'word/embeddings/Microsoft_Excel_Worksheet.xlsx']),
        confirm: true,
      },
    ]);
    expect(prepared.warnings[0].message).toContain('word/embeddings/Microsoft_Excel_Worksheet.xlsx');
  });

  it('asks nothing for pictures, fonts, and a thumbnail, which are never read for words', async () => {
    const prepared = await prepareDocx(
      await docxOf({
        'word/document.xml': `<w:document ${W}><w:body><w:p><w:r><w:t>Photo page</w:t></w:r></w:p></w:body></w:document>`,
        'word/media/image1.png': PNG,
        'word/media/image2.emf': BINARY,
        'word/fonts/font1.odttf': BINARY,
        'docProps/thumbnail.jpeg': BINARY,
      }),
      createContext('photos.docx'),
    );
    expect(prepared.meta.text).toContain('Photo page');
    expect(prepared.warnings).toEqual([]);
  });

  it('names a part that failed to unpack, and a body it could not read', () => {
    const words = docxWords([
      { name: 'word/document.xml', role: 'body', text: null },
      { name: 'word/header1.xml', role: 'word', text: `<w:hdr ${W}><w:p><w:r><w:t>Header words</w:t></w:r></w:p></w:hdr>` },
      { name: 'word/media/image1.png', role: 'picture', text: null },
    ]);
    expect(words.body).toBe('');
    expect(words.unread).toEqual(['word/document.xml']);
    expect(words.text).toContain('Header words');
  });

  it('tells the parts of a Word file apart by their names', () => {
    expect(docxPartRole('word/document.xml')).toBe('body');
    expect(docxPartRole('word/header2.xml')).toBe('word');
    expect(docxPartRole('word/charts/chart1.xml')).toBe('word');
    expect(docxPartRole('word/diagrams/data1.xml')).toBe('word');
    expect(docxPartRole('word/_rels/document.xml.rels')).toBe('relationships');
    expect(docxPartRole('_rels/.rels')).toBe('relationships');
    expect(docxPartRole('docProps/custom.xml')).toBe('properties');
    expect(docxPartRole('customXml/item1.xml')).toBe('data');
    expect(docxPartRole('[trash]/0001.dat')).toBe('data');
    expect(docxPartRole('word/media/image3.svg')).toBe('drawing');
    expect(docxPartRole('word/media/IMAGE1.JPEG')).toBe('picture');
    expect(docxPartRole('docProps/thumbnail.wmf')).toBe('picture');
    expect(docxPartRole('word/fonts/font1.odttf')).toBe('font');
    expect(docxPartRole('word/embeddings/oleObject1.bin')).toBe('embedded');
    expect(docxPartRole('word\\embeddings\\Package.docx')).toBe('embedded');
  });

  it('reads Office XML text and attributes as a reader sees them', () => {
    expect(
      officeXmlText(
        `<w:p ${W}><w:pPr><w:rPr><w:del w:id="3" w:author="A" w:date="d"/></w:rPr></w:pPr><w:r><w:t>Kept</w:t><w:noBreakHyphen/><w:t>text</w:t></w:r></w:p>` +
          '<w:p><w:del w:id="4" w:author="A"><w:r><w:delText>Gone</w:delText></w:r></w:del><w:r><w:t>Here</w:t><w:br/><w:t>there</w:t></w:r></w:p>' +
          '<a:p><a:r><a:t>Drawing</a:t></a:r><a:br><a:rPr/></a:br><a:r><a:t>line</a:t></a:r></a:p><!-- a comment --><![CDATA[a < b]]>',
      ),
    ).toEqual({ text: 'Kept-text\nHere\nthere\nDrawing\nline\na < b\na comment', deleted: ['Gone'] });
    expect(
      officeAttributeText(
        '<w:comment w:author="A &amp; B" w:initials="AB" w:date="2026"/><w:docVar w:name="Var" w:val="Value"/><w:sz w:val="24"/>' +
          '<w:listItem w:displayText="Shown" w:value="Stored"/><w15:presenceInfo w15:providerId="AD" w15:userId="user@example.edu"/>',
      ),
    ).toEqual(['A & B', 'AB', 'Var', 'Shown', 'Stored', 'user@example.edu', 'Value']);
  });
});

// ---------------------------------------------------------------------------------------------

/** A file that fails the test if anything reads it. */
function unreadFile(name: string, size: number): File {
  const fail = () => {
    throw new Error(`${name} was read`);
  };
  return { name, size, type: '', arrayBuffer: fail, text: fail, slice: fail, stream: fail } as unknown as File;
}

describe('the size cap on Word files read on the page (CONVERT-8)', () => {
  it('refuses a Word file over 50 MB before reading it', async () => {
    expect(DOCX_MAX_BYTES).toBe(50_000_000);
    expect(M.docxTooLarge).toContain('50 MB');
    expect(() => checkDocxSize({ name: 'ok.docx', size: DOCX_MAX_BYTES })).not.toThrow();
    const error = await prepareDocx(unreadFile('thesis.docx', DOCX_MAX_BYTES + 1), createContext('thesis.docx')).then(
      () => null,
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(PrepareError);
    expect(error).toMatchObject({ code: 'docx-too-large', file: 'thesis.docx', message: M.docxTooLarge });
  });
});

// ---------------------------------------------------------------------------------------------

/** A PDF whose pages each hold a line of text, or only a filled shape (as a scanned page has no text). */
function pdfBytes(pages: readonly (string | null)[]): Uint8Array<ArrayBuffer> {
  const objects: string[] = [];
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  const kids: string[] = [];
  pages.forEach((words, i) => {
    const page = 4 + i * 2;
    const stream = words === null ? '0.2 0.2 0.2 rg 72 72 400 600 re f' : `BT /F1 24 Tf 72 700 Td (${words}) Tj ET`;
    kids.push(`${page} 0 R`);
    objects[page] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${page + 1} 0 R >>`;
    objects[page + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  objects[2] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages.length} >>`;
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = out.length;
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) out += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out) as Uint8Array<ArrayBuffer>;
}

const pdfGlobals = globalThis as unknown as { DOMMatrix?: unknown; pdfjsWorker?: unknown };
const savedPdfGlobals = { DOMMatrix: pdfGlobals.DOMMatrix, pdfjsWorker: pdfGlobals.pdfjsWorker };

describe('every PDF page without readable text is named (CONVERT-3)', () => {
  beforeAll(async () => {
    // pdf.js's display layer builds a DOMMatrix when it loads; reading text never uses it.
    class DOMMatrixStandIn {
      a = 1;
      b = 0;
      c = 0;
      d = 1;
      e = 0;
      f = 0;
      multiplySelf() {
        return this;
      }
      preMultiplySelf() {
        return this;
      }
      translate() {
        return this;
      }
      scale() {
        return this;
      }
      invertSelf() {
        return this;
      }
    }
    pdfGlobals.DOMMatrix ??= DOMMatrixStandIn;
    // With the worker's module on this global, pdf.js runs its worker code on this thread.
    // @ts-expect-error pdf.js ships no types for its worker module.
    pdfGlobals.pdfjsWorker = await import('pdfjs-dist/build/pdf.worker.mjs');
  });
  afterAll(() => {
    pdfGlobals.DOMMatrix = savedPdfGlobals.DOMMatrix;
    pdfGlobals.pdfjsWorker = savedPdfGlobals.pdfjsWorker;
  });

  const run = async (pages: readonly (string | null)[]) => {
    const file = new File([pdfBytes(pages)], 'report.pdf', { type: 'application/pdf' });
    return preparePdf(file, createContext('report.pdf'));
  };
  const unreadable = (warnings: { code: string }[]) => warnings.filter((warning) => warning.code === 'text-unreadable');

  it('names a scanned page after a typed cover page', async () => {
    const prepared = await run(['Cover page', null]);
    expect(prepared.meta.pages).toBe(2);
    expect(prepared.meta.text).toContain('Cover page');
    expect(unreadable(prepared.warnings)).toEqual([{ code: 'text-unreadable', message: M.pagesUnreadable([2]), confirm: true }]);
    expect(prepared.warnings[0].message).toContain('page 2');
  }, 60_000);

  it('names every such page in one warning', async () => {
    const prepared = await run(['One', null, 'Three', null, null]);
    expect(unreadable(prepared.warnings)).toEqual([{ code: 'text-unreadable', message: M.pagesUnreadable([2, 4, 5]), confirm: true }]);
    expect(prepared.warnings[0].message).toContain('pages 2, 4, and 5');
  }, 60_000);

  it('says the whole document when no page has text, and nothing when every page has', async () => {
    expect(unreadable((await run([null, null])).warnings)).toEqual([{ code: 'text-unreadable', message: M.textUnreadable, confirm: true }]);
    expect(unreadable((await run(['First', 'Second'])).warnings)).toEqual([]);
  }, 60_000);

  it('names the pages whose text or notes fail to read, and keeps the words of the others', async () => {
    vi.resetModules();
    vi.doMock('pdfjs-dist', () => {
      const page = (number: number) => ({
        getTextContent: async () => {
          if (number === 2) throw new Error('bad content stream');
          return { items: [{ str: `Words of page ${number}`, hasEOL: true }] };
        },
        getAnnotations: async () => {
          if (number === 3) throw new Error('bad annotations');
          return [];
        },
        getViewport: () => {
          throw new Error('no canvas here');
        },
        cleanup: () => undefined,
      });
      const pdf = {
        numPages: 5,
        getMetadata: async () => ({ info: {}, metadata: null }),
        getOutline: async () => null,
        getPage: async (number: number) => {
          if (number === 4) throw new Error('broken page');
          return page(number);
        },
        destroy: async () => undefined,
      };
      return {
        GlobalWorkerOptions: {},
        VerbosityLevel: { ERRORS: 0 },
        getDocument: () => ({ promise: Promise.resolve(pdf), destroy: async () => undefined }),
      };
    });
    try {
      const { preparePdf: preparePdfWithStandIn } = await import('@/lib/admin/convert/document');
      const prepared = await preparePdfWithStandIn(new File([pdfBytes(['x'])], 'odd.pdf'), createContext('odd.pdf'));
      expect(prepared.meta.text).toContain('Words of page 1');
      expect(prepared.meta.text).toContain('Words of page 5');
      expect(unreadable(prepared.warnings)).toEqual([{ code: 'text-unreadable', message: M.pagesUnreadable([2, 3, 4]), confirm: true }]);
      expect(prepared.warnings[0].message).toContain('pages 2 to 4');
    } finally {
      vi.doUnmock('pdfjs-dist');
      vi.resetModules();
    }
  });

  it('writes page lists in few words', () => {
    expect(pageList([2])).toBe('page 2');
    expect(pageList([3, 2])).toBe('pages 2 and 3');
    expect(pageList([2, 3, 4])).toBe('pages 2 to 4');
    expect(pageList([2, 5, 7, 8, 9])).toBe('pages 2, 5, and 7 to 9');
    expect(pageList(Array.from({ length: 20 }, (_, i) => 1 + i * 2))).toBe('pages 1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, and 8 more');
  });
});
