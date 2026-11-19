/**
 * The type of an upload from its bytes, the check against its name, and the removal of image
 * metadata (ARCHITECTURE.md 11 "Paths"; docs/V3_PLAN.md D-24, D-26, D-30). Every file here is
 * built in code: tiny, valid files of each accepted type, and a few that must be refused.
 */
import { crc32, deflateSync } from 'node:zlib';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { ApiFailure } from '../lib/admin/server/guard';
import {
  bufferSource,
  cleanEmbeddedImage,
  detectType,
  PHOTO_MESSAGE,
  refuseByName,
  scanImageMetadata,
  sniffFile,
  streamSource,
  stripPngMetadata,
  stripWebpMetadata,
  zipNamesFromCentralDirectory,
} from '../lib/admin/server/sniff';

// ---------------------------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------------------------

const enc = (text: string) => new TextEncoder().encode(text);

function cat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
}

function u32le(n: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, n, true);
  return out;
}

function u32be(n: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, n, false);
  return out;
}

function riffChunk(fourcc: string, data: Uint8Array): Uint8Array {
  return cat(enc(fourcc), u32le(data.byteLength), data, new Uint8Array(data.byteLength % 2));
}

function webp(chunks: Uint8Array[]): Uint8Array {
  const body = cat(enc('WEBP'), ...chunks);
  return cat(enc('RIFF'), u32le(body.byteLength), body);
}

/** A 1 x 1 lossless WebP (one VP8L chunk). */
const WEBP_1X1 = Uint8Array.from(Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64'));
const VP8L_CHUNK = WEBP_1X1.subarray(12);

/** The same picture as an extended WebP whose VP8X flags announce EXIF and XMP, with both chunks. */
function webpWithMetadata(): Uint8Array {
  const vp8x = riffChunk('VP8X', new Uint8Array([0x08 | 0x04, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
  const exif = riffChunk('EXIF', cat(enc('Exif'), new Uint8Array([0, 0]), enc('II*'), new Uint8Array([0, 8, 0, 0, 0, 0, 0])));
  const xmp = riffChunk('XMP ', enc('<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF/></x:xmpmeta>'));
  return webp([vp8x, VP8L_CHUNK, exif, xmp]);
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const name = enc(type);
  return cat(u32be(data.byteLength), name, data, u32be(crc32(cat(name, data))));
}

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IHDR = pngChunk('IHDR', new Uint8Array([0, 0, 0, 1, 0, 0, 0, 1, 8, 0, 0, 0, 0]));
const IDAT = pngChunk('IDAT', deflateSync(Buffer.from([0, 0])));
const IEND = pngChunk('IEND', new Uint8Array(0));
const PNG_1X1 = cat(PNG_SIGNATURE, IHDR, IDAT, IEND);

/** A PNG with every kind of metadata chunk the server drops, and bytes after its end. */
function pngWithMetadata(): Uint8Array {
  return cat(
    PNG_SIGNATURE,
    IHDR,
    pngChunk('tEXt', enc('Author\u0000Someone')),
    pngChunk('tIME', new Uint8Array([7, 234, 11, 18, 12, 0, 0])),
    IDAT,
    pngChunk('iTXt', enc('XML:com.adobe.xmp\u0000\u0000\u0000\u0000\u0000<x:xmpmeta/>')),
    pngChunk('zTXt', cat(enc('Comment\u0000\u0000'), deflateSync(Buffer.from('a note')))),
    pngChunk('eXIf', cat(enc('II*'), new Uint8Array([0, 8, 0, 0, 0]))),
    IEND,
    enc('trailing bytes'),
  );
}

function isoBox(type: string, payload: Uint8Array): Uint8Array {
  return cat(u32be(8 + payload.byteLength), enc(type), payload);
}

const MP4 = cat(isoBox('ftyp', cat(enc('isom'), u32be(0x200), enc('isomiso2avc1mp41'))), isoBox('free', new Uint8Array(8)));
const MOV = cat(isoBox('ftyp', cat(enc('qt  '), u32be(0), enc('qt  '))), isoBox('free', new Uint8Array(8)));
const M4A = cat(isoBox('ftyp', cat(enc('M4A '), u32be(0), enc('M4A isomiso2'))), isoBox('free', new Uint8Array(8)));
/** An EBML header with the document type "webm". */
const WEBM = new Uint8Array([
  0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01, 0x42, 0xf2, 0x81, 0x04, 0x42, 0xf3, 0x81,
  0x08, 0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d, 0x42, 0x87, 0x81, 0x04, 0x42, 0x85, 0x81, 0x02,
]);
const PDF = enc('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');
const MP3 = cat(enc('ID3'), new Uint8Array([3, 0, 0, 0, 0, 0, 0]), new Uint8Array([0xff, 0xfb, 0x90, 0x64]), new Uint8Array(413));
const WAV = cat(
  enc('RIFF'),
  u32le(36),
  enc('WAVE'),
  enc('fmt '),
  u32le(16),
  new Uint8Array([1, 0, 1, 0, 0x44, 0xac, 0, 0, 0x88, 0x58, 1, 0, 2, 0, 16, 0]),
  enc('data'),
  u32le(0),
);

function glb(lengthDelta = 0): Uint8Array {
  let json: Uint8Array = enc('{"asset":{"version":"2.0"},"nodes":[{"name":"arm"}]}');
  while (json.byteLength % 4 !== 0) json = cat(json, enc(' '));
  const chunk = cat(u32le(json.byteLength), enc('JSON'), json);
  return cat(enc('glTF'), u32le(2), u32le(12 + chunk.byteLength + lengthDelta), chunk);
}

const GLTF = enc('{"asset":{"version":"2.0"},"scenes":[{"nodes":[]}]}');
const STL_ASCII = enc('solid cube\n facet normal 0 0 1\n  outer loop\n   vertex 0 0 0\n   vertex 1 0 0\n   vertex 0 1 0\n  endloop\n endfacet\nendsolid cube\n');
/** An 80-byte header, one triangle, and its 50 bytes. */
const STL_BINARY = cat(new Uint8Array(80), u32le(1), new Uint8Array(50));
const OBJ = enc('# a bracket\no bracket\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n');
const PLY = enc('ply\nformat ascii 1.0\nelement vertex 1\nproperty float x\nend_header\n0\n');
const VTT = enc('WEBVTT\n\n00:00.000 --> 00:01.000\nThe arm folds.\n');
const SVG = enc('<?xml version="1.0" encoding="UTF-8"?>\n<!-- drawing -->\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0L10 10"/></svg>');
/** A CSV whose first letters are a bitmap's signature to file-type. */
const CSV = enc('BMS cell,voltage\n1,3.7\n2,3.8\n');
const TXT = enc('Notes for the build.\n');
const STEP = enc("ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('bracket'),'2;1');\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n");
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
const GIF = cat(enc('GIF89a'), new Uint8Array([1, 0, 1, 0, 0, 0, 0, 0x3b]));
/** The start of a HEIC photo: an ftyp box with the heic brand. */
const HEIC = isoBox('ftyp', cat(enc('heic'), u32be(0), enc('mif1heic')));

function jpegSegment(marker: number, data: Uint8Array): Uint8Array {
  const size = data.byteLength + 2;
  return cat(new Uint8Array([0xff, marker, size >> 8, size & 0xff]), data);
}

/** JPEG structure: every metadata segment the server drops, around the parts it keeps. */
const JPEG_PART = {
  soi: new Uint8Array([0xff, 0xd8]),
  /** JFIF with a 1 x 1 thumbnail, and the same header as stored: thumbnail size zero. */
  jfifThumb: jpegSegment(0xe0, cat(enc('JFIF\u0000'), new Uint8Array([1, 2, 0, 0, 72, 0, 72, 1, 1, 9, 9, 9]))),
  jfif: jpegSegment(0xe0, cat(enc('JFIF\u0000'), new Uint8Array([1, 2, 0, 0, 72, 0, 72, 0, 0]))),
  exif: jpegSegment(0xe1, cat(enc('Exif\u0000\u0000MM\u0000*'), enc('GPS 37.35 N 121.94 W'))),
  xmp: jpegSegment(0xe1, enc('http://ns.adobe.com/xap/1.0/\u0000<x:xmpmeta/>')),
  icc: jpegSegment(0xe2, cat(enc('ICC_PROFILE\u0000'), new Uint8Array([1, 1, 0, 0]))),
  mpf: jpegSegment(0xe2, cat(enc('MPF\u0000'), new Uint8Array(8))),
  iptc: jpegSegment(0xed, enc('Photoshop 3.0\u0000by-line')),
  adobe: jpegSegment(0xee, cat(enc('Adobe'), new Uint8Array([0, 100, 0, 0, 0, 0, 1]))),
  comment: jpegSegment(0xfe, enc('a note')),
  tables: jpegSegment(0xdb, new Uint8Array(65)),
  frame: jpegSegment(0xc0, new Uint8Array([8, 0, 1, 0, 1, 1, 1, 0x11, 0])),
  scan: jpegSegment(0xda, new Uint8Array([1, 1, 0, 0, 0x3f, 0])),
  data: new Uint8Array([0x12, 0xff, 0x00, 0x34, 0xff, 0xd3, 0x56]),
  eoi: new Uint8Array([0xff, 0xd9]),
};

function gifBlock(...parts: (number[] | string)[]): Uint8Array {
  return cat(...parts.map((part) => (typeof part === 'string' ? enc(part) : new Uint8Array(part))));
}

/** A 1 x 1 GIF with a two-colour table, looping, a comment, XMP, frame timing, and data after its end. */
const GIF_PART = {
  head: gifBlock('GIF89a', [1, 0, 1, 0, 0x80, 0, 0], [0, 0, 0, 255, 255, 255]),
  loop: gifBlock([0x21, 0xff, 11], 'NETSCAPE2.0', [3, 1, 0, 0, 0]),
  comment: gifBlock([0x21, 0xfe, 6], 'a note', [0]),
  xmp: gifBlock([0x21, 0xff, 11], 'XMP DataXMP', [12], '<x:xmpmeta/>', [0]),
  timing: gifBlock([0x21, 0xf9, 4, 0, 10, 0, 0, 0]),
  frame: gifBlock([0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0], [2, 2, 0x4c, 0x01, 0]),
  end: gifBlock([0x3b]),
};

async function zipOf(entries: Record<string, string>): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [name, text] of Object.entries(entries)) zip.file(name, text);
  return zip.generateAsync({ type: 'uint8array' });
}

const WORD_TYPES =
  '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';

const docx = () =>
  zipOf({
    '[Content_Types].xml': WORD_TYPES,
    '_rels/.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>',
    'word/document.xml': '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>',
  });
const threeMf = () =>
  zipOf({
    '[Content_Types].xml':
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>',
    '3D/3dmodel.model': '<model unit="millimeter"/>',
  });
const plainZip = () => zipOf({ 'readme.txt': 'hello' });

async function refusal(work: Promise<unknown>): Promise<ApiFailure> {
  try {
    await work;
  } catch (error) {
    if (error instanceof ApiFailure) return error;
    throw error;
  }
  throw new Error('Expected a refusal.');
}

/** The chunk names of a WebP file, in order. */
function webpChunks(bytes: Uint8Array): string[] {
  const names: string[] = [];
  let at = 12;
  while (at + 8 <= bytes.byteLength) {
    const size = new DataView(bytes.buffer, bytes.byteOffset).getUint32(at + 4, true);
    names.push(new TextDecoder().decode(bytes.subarray(at, at + 4)));
    at += 8 + size + (size % 2);
  }
  return names;
}

// ---------------------------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------------------------

describe('the type of a file from its bytes', () => {
  const accepted: [string, () => Uint8Array | Promise<Uint8Array>, string, string][] = [
    ['a WebP photo', () => WEBP_1X1, 'webp', 'webp'],
    ['a PNG drawing', () => PNG_1X1, 'png', 'png'],
    ['an SVG drawing with a prolog and a comment', () => SVG, 'svg', 'svg'],
    ['a PDF', () => PDF, 'pdf', 'pdf'],
    ['an MP4 video', () => MP4, 'mp4', 'mp4'],
    ['a QuickTime video', () => MOV, 'mov', 'mov'],
    ['a WebM video', () => WEBM, 'webm', 'webm'],
    ['an M4A audio file', () => M4A, 'm4a', 'm4a'],
    ['an MP3 with an ID3 tag', () => MP3, 'mp3', 'mp3'],
    ['a WAV file', () => WAV, 'wav', 'wav'],
    ['a GLB model', () => glb(), 'glb', 'glb'],
    ['a glTF model', () => GLTF, 'gltf', 'gltf'],
    ['an ASCII STL model', () => STL_ASCII, 'stl', 'stl'],
    ['a binary STL model', () => STL_BINARY, 'stl', 'stl'],
    ['an OBJ model', () => OBJ, 'obj', 'obj'],
    ['an ASCII PLY model', () => PLY, 'ply', 'ply'],
    ['a 3MF model', threeMf, '3mf', '3mf'],
    ['a Word document', docx, 'docx', 'docx'],
    ['a ZIP archive', plainZip, 'zip', 'zip'],
    ['WebVTT captions', () => VTT, 'vtt', 'vtt'],
    ['a CSV that starts like a bitmap', () => CSV, 'csv', 'csv'],
    ['a text file', () => TXT, 'txt', 'txt'],
  ];

  it.each(accepted)('accepts %s', async (_label, make, ext, stored) => {
    const sniffed = await sniffFile(await make(), ext);
    expect(sniffed.ext).toBe(stored);
  });

  it('stores an MP4 named .mov under the type of its bytes, and keeps audio named .m4a as audio', async () => {
    expect((await sniffFile(MP4, 'mov')).ext).toBe('mp4');
    expect((await sniffFile(MP4, 'm4a')).ext).toBe('m4a');
  });

  it('recognizes a STEP file and sends it to the media library for conversion', async () => {
    expect((await detectType(STEP))?.ext).toBe('step');
    const refused = await refusal(sniffFile(STEP, 'step'));
    expect(refused.status).toBe(422);
    expect(refused.code).toBe('invalid-file');
    expect(refused.message).toMatch(/GLB/);
  });

  it('refuses PNG bytes named .webp, and a ZIP file named .docx', async () => {
    const png = await refusal(sniffFile(PNG_1X1, 'webp'));
    expect(png).toMatchObject({ status: 422, code: 'invalid-file' });
    expect(png.message).toMatch(/PNG image/);
    const zip = await refusal(sniffFile(await plainZip(), 'docx'));
    expect(zip.message).toMatch(/ZIP archive/);
    await refusal(sniffFile(await docx(), 'pdf'));
  });

  it('refuses the photo formats the media library converts to WebP, by their bytes or by their name', async () => {
    expect((await refusal(sniffFile(JPEG, 'jpg'))).message).toBe(PHOTO_MESSAGE);
    expect((await refusal(sniffFile(JPEG, 'webp'))).message).toBe(PHOTO_MESSAGE);
    expect((await refusal(sniffFile(GIF, 'gif'))).message).toBe(PHOTO_MESSAGE);
    expect((await refusal(sniffFile(HEIC, 'heic'))).message).toBe(PHOTO_MESSAGE);
    expect((await refusal(sniffFile(HEIC, 'heif'))).message).toBe(PHOTO_MESSAGE);
    expect((await refusal(sniffFile(WEBP_1X1, 'jpeg'))).message).toBe(PHOTO_MESSAGE);
    expect((await refusal(sniffFile(STEP, 'stp'))).message).toMatch(/GLB/);
    expect(() => refuseByName('HEIC')).toThrow(PHOTO_MESSAGE);
    expect(() => refuseByName('step')).toThrow(/GLB/);
    expect(() => refuseByName('mjs')).toThrow(/refused in every store/);
    expect(() => refuseByName('mp4')).not.toThrow();
  });

  it('says so when a text file is not UTF-8, as a CSV saved by Excel in a legacy encoding is', async () => {
    const latin1 = cat(enc('Temperature,'), new Uint8Array([0xb0]), enc('C\n21,22\n'));
    const refused = await refusal(sniffFile(latin1, 'csv'));
    expect(refused).toMatchObject({ status: 422, code: 'invalid-file' });
    expect(refused.message).toMatch(/not plain UTF-8 text/);
  });

  it('refuses a web page, XML other than SVG, and a script, whatever the name says', async () => {
    const page = enc('<!doctype html><html><body><script>alert(1)</script></body></html>');
    const xml = enc('<?xml version="1.0"?><feed><entry/></feed>');
    const script = enc('const go = () => fetch("/api/save");\ngo();\n');
    for (const [bytes, ext] of [
      [page, 'txt'],
      [page, 'svg'],
      [xml, 'svg'],
      [xml, 'csv'],
      [script, 'txt'],
    ] as const) {
      const refused = await refusal(sniffFile(bytes, ext));
      expect(refused).toMatchObject({ status: 422, code: 'invalid-file' });
      expect(refused.message).toMatch(/refused in every store/);
    }
    expect((await refusal(sniffFile(TXT, 'html'))).message).toMatch(/refused in every store/);
    expect((await refusal(sniffFile(TXT, 'js'))).message).toMatch(/refused in every store/);
  });

  it('refuses a GLB whose length is not its header length', async () => {
    const refused = await refusal(sniffFile(glb(4), 'glb'));
    expect(refused.message).toMatch(/damaged/);
  });

  it('reads the start of a large upload: ZIP entries from the central directory, STL by its size', async () => {
    const word = await docx();
    const read = async (start: number, end: number) => word.subarray(start, end + 1);
    expect(await zipNamesFromCentralDirectory(word.byteLength, read)).toEqual(
      expect.arrayContaining(['[Content_Types].xml', 'word/document.xml']),
    );
    const sniffed = await sniffFile(word.subarray(0, 64), 'docx', {
      partial: true,
      totalSize: word.byteLength,
      zipNames: () => zipNamesFromCentralDirectory(word.byteLength, read),
    });
    expect(sniffed.ext).toBe('docx');

    const triangles = 200_000;
    const header = cat(new Uint8Array(80), u32le(triangles));
    expect((await sniffFile(header, 'stl', { partial: true, totalSize: 84 + 50 * triangles })).ext).toBe('stl');
    await refusal(sniffFile(header, 'stl', { partial: true, totalSize: 84 + 50 * triangles + 1 }));
  });
});

describe('image metadata', () => {
  it('drops the EXIF and XMP chunks of a WebP file, clears their VP8X flags, and rebuilds the RIFF size', async () => {
    const original = webpWithMetadata();
    const before = await scanImageMetadata('webp', bufferSource(original));
    expect(before.metadata).toEqual(expect.arrayContaining(['EXIF', 'XMP', 'EXIF flag', 'XMP flag']));

    const stripped = stripWebpMetadata(original);
    expect(webpChunks(stripped)).toEqual(['VP8X', 'VP8L']);
    expect(stripped[20] & 0x0c).toBe(0);
    expect(new DataView(stripped.buffer).getUint32(4, true)).toBe(stripped.byteLength - 8);
    expect(Buffer.from(stripped.subarray(30)).equals(Buffer.from(VP8L_CHUNK))).toBe(true);
    expect(await scanImageMetadata('webp', bufferSource(stripped))).toEqual({ metadata: [], damaged: false });
    expect((await sniffFile(stripped, 'webp')).ext).toBe('webp');
  });

  it('drops the text, XMP, EXIF, and time chunks of a PNG file and anything after its end', async () => {
    const original = pngWithMetadata();
    const before = await scanImageMetadata('png', bufferSource(original));
    expect(before.metadata).toEqual(expect.arrayContaining(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME', 'data after the image']));

    const stripped = stripPngMetadata(original);
    expect(Buffer.from(stripped).equals(Buffer.from(PNG_1X1))).toBe(true);
    expect(Buffer.from(stripped).includes('tEXt')).toBe(false);
    expect(await scanImageMetadata('png', bufferSource(stripped))).toEqual({ metadata: [], damaged: false });
  });

  it('scans a stream in small pieces without holding the file', async () => {
    const bytes = pngWithMetadata();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let at = 0; at < bytes.byteLength; at += 3) controller.enqueue(bytes.slice(at, at + 3));
        controller.close();
      },
    });
    const scan = await scanImageMetadata('png', streamSource(stream));
    expect(scan.metadata).toEqual(expect.arrayContaining(['tEXt', 'eXIf']));
    expect(scan.damaged).toBe(false);
  });

  it('refuses a damaged image instead of guessing', async () => {
    const cut = webpWithMetadata().subarray(0, 40);
    expect((await refusal(Promise.resolve().then(() => stripWebpMetadata(cut)))).code).toBe('invalid-file');
    expect((await refusal(Promise.resolve().then(() => stripPngMetadata(PNG_1X1.subarray(0, 30))))).code).toBe('invalid-file');
    expect((await scanImageMetadata('webp', bufferSource(cut))).damaged).toBe(true);
  });
});

describe('images embedded in a drawing', () => {
  const J = JPEG_PART;
  const G = GIF_PART;

  it('drops every JPEG metadata segment, the JFIF thumbnail, and data after the end, and keeps the picture', async () => {
    const original = cat(J.soi, J.jfifThumb, J.exif, J.xmp, J.icc, J.mpf, J.iptc, J.adobe, J.comment, J.tables, J.frame, J.scan, J.data, J.eoi, enc('trailing'));
    const cleaned = await cleanEmbeddedImage('jpeg', original);
    const expected = cat(J.soi, J.jfif, J.icc, J.adobe, J.tables, J.frame, J.scan, J.data, J.eoi);
    expect(cleaned && Buffer.from(cleaned).equals(Buffer.from(expected))).toBe(true);
    for (const gone of ['Exif', 'GPS', 'xmpmeta', 'MPF', 'Photoshop', 'a note', 'trailing']) {
      expect(Buffer.from(cleaned!).includes(gone), gone).toBe(false);
    }
  });

  it('drops GIF comments and application data but keeps looping, timing, and the frames', async () => {
    const cleaned = await cleanEmbeddedImage('gif', cat(G.head, G.loop, G.comment, G.xmp, G.timing, G.frame, G.end, enc('trailing')));
    expect(cleaned && Buffer.from(cleaned).equals(Buffer.from(cat(G.head, G.loop, G.timing, G.frame, G.end)))).toBe(true);
  });

  it('cleans PNG and WebP with the upload strippers, and refuses bytes that are not the named type or are cut', async () => {
    expect(Buffer.from((await cleanEmbeddedImage('png', pngWithMetadata()))!).equals(Buffer.from(PNG_1X1))).toBe(true);
    expect(webpChunks((await cleanEmbeddedImage('webp', webpWithMetadata()))!)).toEqual(['VP8X', 'VP8L']);
    expect(await cleanEmbeddedImage('png', JPEG)).toBeNull();
    expect(await cleanEmbeddedImage('jpeg', cat(J.soi, J.jfif, J.tables, J.scan, J.data))).toBeNull();
    expect(await cleanEmbeddedImage('gif', cat(G.head, G.frame))).toBeNull();
  });
});
