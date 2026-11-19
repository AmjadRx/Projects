/**
 * SVG sanitizing at upload (ARCHITECTURE.md 11 "Uploads"; docs/V3_PLAN.md D-24, R-13): nothing in
 * a stored drawing may run or load anything, and an ordinary drawing comes out intact.
 */
import { crc32, deflateSync } from 'node:zlib';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { ApiFailure } from '../lib/admin/server/guard';
import { sanitizeSvg } from '../lib/admin/server/svg';

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const enc = (value: string) => new TextEncoder().encode(value);
const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');

function cat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const name = enc(type);
  const size = new Uint8Array(4);
  const crc = new Uint8Array(4);
  new DataView(size.buffer).setUint32(0, data.byteLength);
  new DataView(crc.buffer).setUint32(0, crc32(cat(name, data)));
  return cat(size, name, data, crc);
}

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_HEAD = cat(PNG_SIGNATURE, pngChunk('IHDR', new Uint8Array([0, 0, 0, 1, 0, 0, 0, 1, 8, 0, 0, 0, 0])));
const PNG_TAIL = cat(pngChunk('IDAT', deflateSync(Buffer.from([0, 0]))), pngChunk('IEND', new Uint8Array(0)));
/** A real 1 x 1 PNG, and the same picture with a text chunk naming a place. */
const PNG_1X1 = cat(PNG_HEAD, PNG_TAIL);
const PNG_WITH_TEXT = cat(PNG_HEAD, pngChunk('tEXt', enc('Location\u0000Somewhere')), PNG_TAIL);

function jpegSegment(marker: number, data: Uint8Array): Uint8Array {
  const size = data.byteLength + 2;
  return cat(new Uint8Array([0xff, marker, size >> 8, size & 0xff]), data);
}

/** A JPEG's structure (not a decodable picture): JFIF, EXIF with a place, a comment, tables, one scan. */
const JPEG_PARTS = {
  soi: new Uint8Array([0xff, 0xd8]),
  jfif: jpegSegment(0xe0, cat(enc('JFIF\u0000'), new Uint8Array([1, 1, 0, 0, 1, 0, 1, 0, 0]))),
  exif: jpegSegment(0xe1, cat(enc('Exif\u0000\u0000II*\u0000'), new Uint8Array([8, 0, 0, 0]), enc('GPS 37.35 N'))),
  comment: jpegSegment(0xfe, enc('taken at home')),
  tables: jpegSegment(0xdb, new Uint8Array(65)),
  frame: jpegSegment(0xc0, new Uint8Array([8, 0, 1, 0, 1, 1, 1, 0x11, 0])),
  scan: jpegSegment(0xda, new Uint8Array([1, 1, 0, 0, 0x3f, 0])),
  // Coded data with a stuffed 0xFF and a restart marker inside, then the end of the image.
  data: new Uint8Array([0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56]),
  eoi: new Uint8Array([0xff, 0xd9]),
};
const J = JPEG_PARTS;
const JPEG_WITH_EXIF = cat(J.soi, J.jfif, J.exif, J.comment, J.tables, J.frame, J.scan, J.data, J.eoi);
const JPEG_CLEAN = cat(J.soi, J.jfif, J.tables, J.frame, J.scan, J.data, J.eoi);

/** The bytes of the first embedded image's data address in a stored drawing. */
function embedded(doc: Document): Uint8Array | null {
  const href = doc.getElementsByTagName('image')[0]?.getAttribute('href');
  const match = href ? /^data:image\/[a-z]+;base64,(.*)$/.exec(href) : null;
  return match ? new Uint8Array(Buffer.from(match[1], 'base64')) : null;
}

/** Parses the stored drawing as an SVG document, the way a browser opening the file would. */
function parse(bytes: Uint8Array): Document {
  const { window } = new JSDOM('');
  const doc = new window.DOMParser().parseFromString(text(bytes), 'image/svg+xml');
  expect(doc.getElementsByTagName('parsererror')).toHaveLength(0);
  return doc;
}

async function refusal(work: Promise<unknown>): Promise<ApiFailure> {
  try {
    await work;
  } catch (error) {
    if (error instanceof ApiFailure) return error;
    throw error;
  }
  throw new Error('Expected a refusal.');
}

const PLAIN = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 120 80">
  <title>Bracket</title>
  <desc>Side view</desc>
  <defs>
    <linearGradient id="steel"><stop offset="0" stop-color="#889"/><stop offset="1" stop-color="#ccd"/></linearGradient>
    <symbol id="hole"><circle cx="0" cy="0" r="3"/></symbol>
    <clipPath id="frame"><rect width="120" height="80"/></clipPath>
  </defs>
  <style>.edge { stroke: #223; fill: url(#steel); }</style>
  <g id="bracket-body" class="edge" clip-path="url(#frame)" stroke-width="1.5">
    <path d="M10 10 H110 V70 H10 Z"/>
    <use href="#hole" x="20" y="20"/>
    <use xlink:href="#hole" x="100" y="20"/>
    <text x="60" y="45" font-size="8">Bracket <tspan font-weight="bold">A</tspan></text>
  </g>
</svg>`;

const HOSTILE = `<?xml version="1.0"?>
<!DOCTYPE svg [ <!ENTITY name "value"> ]>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10" onload="alert(1)">
  <script>alert(2)</script>
  <style>@import url(https://evil.example/a.css); .x { fill: red }</style>
  <style>.y { fill: url(https://evil.example/fill.svg#g) }</style>
  <foreignObject width="10" height="10"><div xmlns="http://www.w3.org/1999/xhtml">hello</div></foreignObject>
  <a href="javascript:alert(3)"><rect width="5" height="5"/></a>
  <use href="https://evil.example/sprite.svg#icon"/>
  <use xlink:href="data:image/svg+xml;base64,PHN2Zy8+"/>
  <image href="https://evil.example/tracker.png" width="1" height="1"/>
  <image href="data:image/png;base64,${base64(PNG_1X1)}" width="1" height="1"/>
  <circle r="2" onclick="alert(4)" fill="url(https://evil.example/x)" style="fill: url('https://evil.example/y')"/>
  <animate attributeName="href" to="javascript:alert(5)"/>
  <set attributeName="onmouseover" to="alert(6)"/>
  <path d="M0 0L10 10"/>
</svg>`;

describe('sanitizeSvg', () => {
  it('keeps an ordinary drawing: paths, groups, text, gradients, defs, symbols, and use with #id', async () => {
    const { bytes, text: words } = await sanitizeSvg(new TextEncoder().encode(PLAIN));
    const doc = parse(bytes);
    const root = doc.documentElement;
    expect(root.localName).toBe('svg');
    expect(root.getAttribute('viewBox')).toBe('0 0 120 80');
    for (const name of ['title', 'desc', 'defs', 'linearGradient', 'stop', 'symbol', 'clipPath', 'style', 'g', 'path', 'use', 'text', 'tspan', 'circle', 'rect']) {
      expect(doc.getElementsByTagName(name).length, name).toBeGreaterThan(0);
    }
    expect(doc.getElementsByTagName('use')).toHaveLength(2);
    const uses = Array.from(doc.getElementsByTagName('use'));
    expect(uses.map((use) => use.getAttribute('href') ?? use.getAttributeNS('http://www.w3.org/1999/xlink', 'href'))).toEqual(['#hole', '#hole']);
    expect(doc.getElementById('bracket-body')?.getAttribute('clip-path')).toBe('url(#frame)');
    expect(doc.getElementsByTagName('path')[0].getAttribute('d')).toBe('M10 10 H110 V70 H10 Z');
    expect(doc.getElementsByTagName('style')[0].textContent).toContain('url(#steel)');
    expect(words).toContain('Bracket');
    expect(words).toContain('Side view');
    expect(words).not.toContain('stroke');
  });

  it('removes scripts, event handlers, javascript: links, foreignObject, outside references, @import, and animation', async () => {
    const { bytes } = await sanitizeSvg(HOSTILE);
    const out = text(bytes);
    for (const banned of ['<script', 'alert', 'onload', 'onclick', 'javascript:', 'foreignObject', 'evil.example', '@import', '<animate', '<set', 'ENTITY', 'DOCTYPE', 'data:image/svg+xml']) {
      expect(out, banned).not.toContain(banned);
    }
    const doc = parse(bytes);
    expect(doc.getElementsByTagName('path')).toHaveLength(1);
    expect(doc.getElementsByTagName('rect')).toHaveLength(1);
    const images = Array.from(doc.getElementsByTagName('image'));
    expect(images.map((image) => image.getAttribute('href'))).toEqual([null, `data:image/png;base64,${base64(PNG_1X1)}`]);
    const styles = Array.from(doc.getElementsByTagName('style'));
    expect(styles).toHaveLength(0);
    const circle = doc.getElementsByTagName('circle')[0];
    expect(circle.getAttribute('fill')).toBeNull();
    expect(circle.getAttribute('style')).toBeNull();
    expect(circle.getAttribute('r')).toBe('2');
  });

  it('refuses a file that is not an SVG drawing', async () => {
    for (const input of ['<!doctype html><html><body><svg></svg></body></html>', 'just words', '<?xml version="1.0"?><feed/>', '<svg:svg xmlns:svg="http://www.w3.org/2000/svg"/>']) {
      const refused = await refusal(sanitizeSvg(input));
      expect(refused).toMatchObject({ status: 422, code: 'invalid-file' });
    }
    expect((await refusal(sanitizeSvg(new Uint8Array([0xff, 0xfe, 0x3c, 0x00])))).code).toBe('invalid-file');
  });

  it('refuses a drawing that sanitizes to nothing', async () => {
    const refused = await refusal(sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><foreignObject/></svg>'));
    expect(refused).toMatchObject({ status: 422, code: 'invalid-file' });
    expect(refused.message).toMatch(/Nothing is left/);
  });

  it('drops editor metadata and private data with everything inside them, and unwraps links', async () => {
    const drawing = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
      xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
      xmlns:cc="http://creativecommons.org/ns#" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:i="http://ns.adobe.com/AdobeIllustrator/10.0/"
      sodipodi:docname="private-name.svg" viewBox="0 0 10 10">
      <sodipodi:namedview pagecolor="#ffffff"><inkscape:page width="10" height="10"/></sodipodi:namedview>
      <metadata><rdf:RDF><cc:Work><dc:creator><cc:Agent><dc:title>Author Of Record</dc:title></cc:Agent></dc:creator></cc:Work></rdf:RDF></metadata>
      <i:pgf id="adobe_illustrator_pgf"><![CDATA[eJzsvWuPHMlxKPpZ]]></i:pgf>
      <a href="#part"><rect id="part" width="4" height="4" inkscape:label="Part"/><text x="1" y="9">Part A</text></a>
    </svg>`;
    const { bytes, text: words } = await sanitizeSvg(drawing);
    const out = text(bytes);
    for (const gone of ['Author Of Record', 'private-name', 'eJzsvWuPHMlxKPpZ', 'namedview', 'inkscape', 'metadata', '<a']) {
      expect(out, gone).not.toContain(gone);
    }
    const doc = parse(bytes);
    expect(doc.getElementsByTagName('rect')).toHaveLength(1);
    expect(doc.documentElement.getElementsByTagName('text')[0]?.parentNode).toBe(doc.documentElement);
    expect(words).toBe('Part A');
  });

  it('removes the metadata of embedded images and drops an image that is not what it claims', async () => {
    const drawing = (href: string) =>
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><image href="${href}" width="10" height="10"/><path d="M0 0L10 10"/></svg>`;

    const jpeg = parse((await sanitizeSvg(drawing(`data:image/jpeg;base64,${base64(JPEG_WITH_EXIF)}`))).bytes);
    expect(Buffer.from(embedded(jpeg)!).equals(Buffer.from(JPEG_CLEAN))).toBe(true);

    const png = parse((await sanitizeSvg(drawing(`data:image/png;base64,${base64(PNG_WITH_TEXT)}`))).bytes);
    expect(Buffer.from(embedded(png)!).equals(Buffer.from(PNG_1X1))).toBe(true);

    const mislabelled = parse((await sanitizeSvg(drawing(`data:image/png;base64,${base64(JPEG_CLEAN)}`))).bytes);
    expect(embedded(mislabelled)).toBeNull();
    expect(mislabelled.getElementsByTagName('path')).toHaveLength(1);
  });

  it('drops a style attribute or a <style> that hides a name behind a CSS escape', async () => {
    const { bytes } = await sanitizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg"><style>.a { fill: \\75 rl(https://evil.example/a) }</style><rect style="fill: \\75 rl(x)" width="1" height="1"/></svg>',
    );
    const out = text(bytes);
    expect(out).not.toContain('evil.example');
    expect(out).not.toContain('style=');
    expect(out).toContain('<rect');
  });

  // MEDIA-3: the browser builds a style sheet from the style's own text, and parses presentation
  // attributes as CSS, so neither may hide a way to load a file from the check.
  it('removes a <style> whose text an element splits, since the browser reads only its own text', async () => {
    for (const style of [
      '<style>@imp<g>Z</g>ort "https://evil.example/x.css";</style>',
      '<style>rect { fill: u<g>Z</g>rl(https://evil.example/p.svg#g) }</style>',
      '<style>.a { fill: #223 }<g/></style>',
    ]) {
      const { bytes } = await sanitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${style}<rect width="10" height="10"/></svg>`);
      const doc = parse(bytes);
      expect(doc.getElementsByTagName('style'), style).toHaveLength(0);
      expect(text(bytes), style).not.toMatch(/evil\.example|@imp|<g/);
      expect(doc.getElementsByTagName('rect'), style).toHaveLength(1);
    }
  });

  it('applies the style test to every attribute: escapes, image-set(), image(), src(), and outside url() go', async () => {
    const jpeg = `data:image/jpeg;base64,${base64(JPEG_WITH_EXIF)}`;
    const attributes = [
      'fill="u\\72l(https://evil.example/p.svg#g)"',
      'mask="image-set(\'https://evil.example/m.png\' 1x)"',
      'mask="-webkit-image-set(\'https://evil.example/m.png\' 1x)"',
      'filter="image(\'https://evil.example/f.png\')"',
      'stroke="src(\'https://evil.example/s.svg\')"',
      'cursor="url(https://evil.example/c.cur), auto"',
      `fill="url(${jpeg})"`,
      'fill="expression(alert(1))"',
    ];
    for (const attribute of attributes) {
      const { bytes } = await sanitizeSvg(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect id="r" width="10" height="10" ${attribute}/></svg>`,
      );
      const out = text(bytes);
      expect(out, attribute).not.toMatch(/evil\.example|data:image\/jpeg|expression/);
      const rect = parse(bytes).getElementById('r');
      expect(rect?.getAttribute('width'), attribute).toBe('10');
      expect([...(rect?.attributes ?? [])].map((attr) => attr.name).sort(), attribute).toEqual(['height', 'id', 'width']);
    }
  });

  it('keeps ordinary presentation attributes and references inside the drawing', async () => {
    const { bytes } = await sanitizeSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><defs><linearGradient id="g"><stop offset="0" stop-color="#889"/></linearGradient><mask id="m"><rect width="5" height="5" fill="#fff"/></mask></defs>' +
        '<g transform="translate(1 2) rotate(45)" font-family="\'Segoe UI\', sans-serif"><rect id="r" width="10" height="10" fill="url(#g)" mask="url(\'#m\')" stroke="currentColor" stroke-dasharray="2 1"/></g></svg>',
    );
    const doc = parse(bytes);
    const rect = doc.getElementById('r')!;
    expect(rect.getAttribute('fill')).toBe('url(#g)');
    expect(rect.getAttribute('mask')).toBe("url('#m')");
    expect(rect.getAttribute('stroke-dasharray')).toBe('2 1');
    expect(doc.getElementsByTagName('g')[0].getAttribute('transform')).toBe('translate(1 2) rotate(45)');
    expect(doc.getElementsByTagName('g')[0].getAttribute('font-family')).toBe("'Segoe UI', sans-serif");
  });
});
