/**
 * The parts of the admin's upload preparation (lib/admin/convert/) that run without a browser:
 * grouping, recognizing files from their bytes, zip directories, the words taken from files,
 * waveform peaks, names, the STEP cap and worker driver, and the orchestration of prepareUploads
 * for the formats that need no browser API. The conversions themselves (photos, video, audio,
 * PDF, models) are checked in a real browser on /dev-convert.
 */
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { describe, expect, it, vi } from 'vitest';
import { peaksOf } from '@/lib/admin/convert/audio';
import { classifyZip, detect, gifIsAnimated, rootElementOf, sniff, textOf, webpIsAnimated } from '@/lib/admin/convert/detect';
import { prepareDocx } from '@/lib/admin/convert/document';
import { gltfReferences, groupFiles, mtlTextureReferences, objMaterialLibraries } from '@/lib/admin/convert/group';
import { prepareUploads } from '@/lib/admin/convert';
import { CONVERT_MESSAGES as M } from '@/lib/admin/convert/messages';
import { posterTime } from '@/lib/admin/convert/poster';
import { checkStepSize, runStepWorker, type StepResult, type WorkerLike } from '@/lib/admin/convert/step';
import {
  decodeEntities,
  externalTargets,
  isWebVtt,
  propertiesXmlText,
  svgSize,
  svgText,
  tidyText,
  vttCueText,
  wordXmlText,
} from '@/lib/admin/convert/text';
import { PrepareError, type PrepareProgress } from '@/lib/admin/convert/types';
import {
  baseOf,
  contentTypeFor,
  createContext,
  extOf,
  fitWithin,
  isWebPBytes,
  matchKey,
  outputName,
  posterName,
  STEP_MAX_BYTES,
} from '@/lib/admin/convert/util';
import { codecTagOf, descriptiveTagText, hasPersonalTags } from '@/lib/admin/convert/video';
import { countColors, hasTransparency, looksLikeDrawing } from '@/lib/admin/convert/webp';
import { findCentralDirectory, zipEntryNames } from '@/lib/admin/convert/zip';

const SAMPLES = path.join(process.cwd(), 'public', 'dev', 'samples');
const sample = (name: string) => new Uint8Array(fs.readFileSync(path.join(SAMPLES, name)));
const bytes = (...values: (number | string)[]) => {
  const out: number[] = [];
  for (const value of values) {
    if (typeof value === 'number') out.push(value);
    else for (const char of value) out.push(char.charCodeAt(0));
  }
  return new Uint8Array(out);
};
const text = (value: string) => new TextEncoder().encode(value);
const file = (content: BlobPart | BlobPart[], name: string, type = '') =>
  new File(Array.isArray(content) ? content : [content], name, { type });

/** What sniff() decided, as one short string: the format, "zip", "refuse:<code>", or "unknown". */
function sniffed(head: Uint8Array, name: string, size = head.length): string {
  const result = sniff(head, name, size);
  if (result.kind === 'format') return result.detected.format;
  if (result.kind === 'refuse') return `refuse:${result.code}`;
  return result.kind;
}

async function zipOf(entries: Record<string, string>, options: { firstStored?: string } = {}): Promise<Uint8Array<ArrayBuffer>> {
  const zip = new JSZip();
  if (options.firstStored) zip.file(options.firstStored, entries[options.firstStored], { compression: 'STORE' });
  for (const [name, value] of Object.entries(entries)) if (name !== options.firstStored) zip.file(name, value);
  // A copy on its own ArrayBuffer, which File and Blob take.
  return new Uint8Array(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }));
}

async function expectPrepareError(promise: Promise<unknown>, code: string): Promise<PrepareError> {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(PrepareError);
  expect((error as PrepareError).code).toBe(code);
  return error as PrepareError;
}

// ---------------------------------------------------------------------------------------------

describe('names', () => {
  it('reads extensions and bases from names and paths', () => {
    expect(extOf('Photo.JPG')).toBe('jpg');
    expect(extOf('folder/model.tar.gz')).toBe('gz');
    expect(extOf('README')).toBe('');
    expect(extOf('.hidden')).toBe('');
    expect(baseOf('C:\\Users\\me\\IMG 7414.HEIC')).toBe('IMG 7414');
    expect(baseOf('archive.tar.gz')).toBe('archive.tar');
    expect(baseOf('.webp')).toBe('.webp');
    expect(baseOf('')).toBe('file');
  });

  it('names converted files and posters after the original', () => {
    expect(outputName('IMG_7414.HEIC', 'webp')).toBe('IMG_7414.webp');
    expect(outputName('clip.mov', 'mp4')).toBe('clip.mp4');
    expect(posterName('Rotor assembly.step')).toBe('Rotor assembly-poster.webp');
  });

  it('matches companion references by their decoded last segment, without case', () => {
    expect(matchKey('textures/Wood%20Oak.PNG')).toBe('wood oak.png');
    expect(matchKey('./scene.bin?v=2#x')).toBe('scene.bin');
    expect(matchKey('C:\\models\\Scene.BIN')).toBe('scene.bin');
    expect(matchKey('bad%E0%A4%A.png')).toBe('bad%e0%a4%a.png');
  });

  it('gives each stored extension its content type', () => {
    expect(contentTypeFor('webp')).toBe('image/webp');
    expect(contentTypeFor('glb')).toBe('model/gltf-binary');
    expect(contentTypeFor('vtt')).toBe('text/vtt; charset=utf-8');
    expect(contentTypeFor('odt')).toBe('application/vnd.oasis.opendocument.text');
    expect(contentTypeFor('xyz')).toBe('application/octet-stream');
  });

  it('fits sizes within a long side without enlarging', () => {
    expect(fitWithin(4000, 3000, 2560)).toEqual({ width: 2560, height: 1920 });
    expect(fitWithin(3000, 4000, 2560)).toEqual({ width: 1920, height: 2560 });
    expect(fitWithin(800, 600, 2560)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(10000, 1, 2048)).toEqual({ width: 2048, height: 1 });
  });
});

// ---------------------------------------------------------------------------------------------

describe('grouping', () => {
  it('reads the files a glTF, an OBJ, and an MTL name', () => {
    expect(
      gltfReferences({
        buffers: [{ uri: 'scene.bin' }, { uri: 'data:application/octet-stream;base64,AAAA' }],
        images: [{ uri: 'textures/wood.png' }, { bufferView: 3 }],
      }),
    ).toEqual(['scene.bin', 'textures/wood.png']);
    expect(gltfReferences('not json')).toEqual([]);
    expect(objMaterialLibraries('# a cube\nmtllib cube.mtl\nv 0 0 0\nmtllib  other.mtl  ')).toEqual(['cube.mtl', 'other.mtl']);
    expect(objMaterialLibraries('mtllib a.mtl b.mtl')).toEqual(['a.mtl b.mtl', 'a.mtl', 'b.mtl']);
    expect(
      mtlTextureReferences(
        ['newmtl wood', 'map_Kd -s 2 2 1 -o 0.5 wood.png', 'map_Bump -bm 0.4 normal map.png', 'bump bump.jpg', 'Kd 1 1 1'].join('\n'),
      ),
    ).toEqual(['wood.png', 'normal map.png', 'bump.jpg']);
  });

  it('groups a glTF with the .bin and textures it names, and leaves other photos alone', async () => {
    const gltf = file(JSON.stringify({ asset: { version: '2.0' }, buffers: [{ uri: 'scene.bin' }], images: [{ uri: 'Tex.PNG' }] }), 'scene.gltf');
    const bin = file(new Uint8Array(8), 'scene.bin');
    const texture = file(new Uint8Array(8), 'tex.png');
    const photo = file(new Uint8Array(8), 'holiday.jpg');
    const groups = await groupFiles([photo, texture, gltf, bin]);
    expect(groups.map((group) => [group.main.name, group.companions.map((companion) => companion.name)])).toEqual([
      ['holiday.jpg', []],
      ['scene.gltf', ['scene.bin', 'tex.png']],
    ]);
  });

  it('groups an OBJ with its libraries and their textures, or with the .mtl of its own name', async () => {
    const obj = file('mtllib parts.mtl\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n', 'parts.obj');
    const mtl = file('newmtl a\nmap_Kd skin.jpg\n', 'parts.mtl');
    const skin = file(new Uint8Array(4), 'skin.jpg');
    const plain = file('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n', 'plain.obj');
    const plainMtl = file('newmtl b\nKd 1 0 0\n', 'plain.mtl');
    const stray = file(new Uint8Array(4), 'stray.bin');
    const groups = await groupFiles([obj, mtl, skin, plain, plainMtl, stray]);
    expect(groups.map((group) => [group.main.name, group.companions.map((companion) => companion.name)])).toEqual([
      ['parts.obj', ['parts.mtl', 'skin.jpg']],
      ['plain.obj', ['plain.mtl']],
      ['stray.bin', []],
    ]);
  });

  it('keeps every other file in its own group, in the order dropped', async () => {
    const names = ['b.pdf', 'a.mp4', 'c.glb', 'd.mtl'];
    const groups = await groupFiles(names.map((name) => file(new Uint8Array(1), name)));
    expect(groups.map((group) => group.main.name)).toEqual(names);
    expect(groups.every((group) => group.companions.length === 0)).toBe(true);
  });

  it('gives a glTF that is not JSON no companions', async () => {
    const groups = await groupFiles([file('{ broken', 'x.gltf'), file(new Uint8Array(4), 'x.bin')]);
    expect(groups.map((group) => [group.main.name, group.companions.length])).toEqual([
      ['x.gltf', 0],
      ['x.bin', 0],
    ]);
  });
});

// ---------------------------------------------------------------------------------------------

describe('recognizing files from their bytes', () => {
  it('recognizes the sample files whatever they are called', () => {
    expect(sniffed(sample('photo-wide.webp'), 'renamed.png')).toBe('webp');
    expect(sniffed(sample('drawing.png'), 'drawing.png')).toBe('png');
    expect(sniffed(sample('drawing.svg'), 'drawing.txt')).toBe('svg');
    expect(sniffed(sample('clip.mp4'), 'clip.mp4')).toBe('mp4');
    expect(sniffed(sample('clip.vtt'), 'clip.vtt')).toBe('vtt');
    expect(sniffed(sample('document.pdf'), 'scan.jpg')).toBe('pdf');
    expect(sniffed(sample('document.docx'), 'document.docx')).toBe('zip');
    expect(sniffed(sample('model.glb'), 'model.bin')).toBe('glb');
    expect(sniffed(sample('tone.mp3'), 'tone.mp3')).toBe('mp3');
    expect(sniffed(sample('box.step'), 'box.stp')).toBe('step');
    expect(sniffed(sample('torus.stl'), 'torus.stl')).toBe('stl');
    expect(sniffed(sample('data.csv'), 'data.csv')).toBe('csv');
  });

  it('recognizes images by their signatures', () => {
    expect(sniffed(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 'JFIF'), 'x.jpeg')).toBe('jpeg');
    expect(sniffed(bytes('RIFF', 0, 0, 0, 0, 'WEBPVP8 ', 0, 0, 0, 0), 'x.webp')).toBe('webp');
    expect(sniffed(bytes(0, 0, 0, 0x1c, 'ftypheic', 0, 0, 0, 0, 'mif1heic'), 'IMG_1.HEIC')).toBe('heic');
    expect(sniffed(bytes(0, 0, 0, 0x1c, 'ftypmif1', 0, 0, 0, 0, 'mif1heic'), 'photo.heif')).toBe('heic');
    expect(sniffed(bytes(0, 0, 0, 0x1c, 'ftypavif', 0, 0, 0, 0, 'avifmif1'), 'x.avif')).toBe('avif');
    expect(sniffed(bytes(0, 0, 0, 0x1c, 'ftypmif1', 0, 0, 0, 0, 'mif1avif'), 'x.avif')).toBe('avif');
    expect(sniffed(bytes('BM', 58, 0, 0, 0, 0, 0, 0, 0, 54, 0, 0, 0, 40, 0), 'x.bmp', 58)).toBe('refuse:unsupported-type');
    expect(sniffed(bytes('II*', 0, 8, 0, 0, 0), 'scan.tif')).toBe('refuse:unsupported-type');
  });

  it('tells a still GIF from an animated one, and reads the WebP animation flag', () => {
    const header = [...'GIF89a'].map((c) => c.charCodeAt(0)).concat([1, 0, 1, 0, 0, 0, 0]);
    const image = [0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x44, 0x01, 0];
    const still = new Uint8Array([...header, ...image, 0x3b]);
    const animated = new Uint8Array([...header, 0x21, 0xf9, 4, 0, 10, 0, 0, 0, ...image, 0x21, 0xf9, 4, 0, 10, 0, 0, 0, ...image, 0x3b]);
    expect(gifIsAnimated(still)).toBe(false);
    expect(gifIsAnimated(animated)).toBe(true);
    const detected = sniff(animated, 'x.gif', animated.length);
    expect(detected.kind === 'format' && detected.detected.animated).toBe(true);
    expect(webpIsAnimated(bytes('RIFF', 0, 0, 0, 0, 'WEBPVP8X', 10, 0, 0, 0, 0x02))).toBe(true);
    expect(webpIsAnimated(bytes('RIFF', 0, 0, 0, 0, 'WEBPVP8X', 10, 0, 0, 0, 0x10))).toBe(false);
  });

  it('recognizes video and audio containers', () => {
    expect(sniffed(bytes(0, 0, 0, 0x14, 'ftypqt  ', 0, 0, 0, 0, 'qt  '), 'IMG_1.MOV')).toBe('mov');
    expect(sniffed(bytes(0, 0, 0, 8, 'wide', 0, 0, 0, 8, 'mdat'), 'old.mov')).toBe('mov');
    expect(sniffed(bytes(0, 0, 0, 0x18, 'ftypM4A ', 0, 0, 0, 0, 'M4A isom'), 'memo.m4a')).toBe('mp4');
    expect(sniffed(bytes(0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x82, 0x84, 'webm'), 'x.webm')).toBe('webm');
    expect(sniffed(bytes(0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x82, 0x88, 'matroska'), 'x.mkv')).toBe('refuse:unsupported-type');
    expect(sniffed(bytes('RIFF', 0, 0, 0, 0, 'WAVEfmt '), 'take.wav')).toBe('wav');
    expect(sniffed(bytes('RF64', 0, 0, 0, 0, 'WAVEds64'), 'long.wav')).toBe('wav');
    expect(sniffed(bytes(0xff, 0xfb, 0x90, 0x64), 'x.mp3')).toBe('mp3');
    expect(sniffed(bytes(0xff, 0xf1, 0x50, 0x80), 'x.aac')).toBe('refuse:unsupported-type');
    expect(sniffed(bytes('fLaC', 0, 0, 0, 0x22), 'x.flac')).toBe('refuse:unsupported-type');
    expect(sniffed(bytes('OggS', 0, 2), 'x.ogg')).toBe('refuse:unsupported-type');
    expect(sniffed(bytes('RIFF', 0, 0, 0, 0, 'AVI LIST'), 'x.avi')).toBe('refuse:unsupported-type');
  });

  it('refuses programs and scripts whatever they are called, but not text that starts with MZ', () => {
    expect(sniffed(bytes('MZ', 0x90, 0, 3, 0, 0, 0, 4, 0, 0, 0, 0xff, 0xff), 'setup.zip')).toBe('refuse:refused-program');
    expect(sniffed(bytes(0x7f, 'ELF', 2, 1, 1, 0), 'photo.jpg')).toBe('refuse:refused-program');
    expect(sniffed(bytes(0xcf, 0xfa, 0xed, 0xfe, 7, 0, 0, 1), 'x.png')).toBe('refuse:refused-program');
    expect(sniffed(bytes(0, 'asm', 1, 0, 0, 0), 'x.glb')).toBe('refuse:refused-program');
    expect(sniffed(text('#!/bin/sh\nrm -rf /\n'), 'notes.txt')).toBe('refuse:refused-program');
    expect(sniffed(text('MZ,count\nA,1\n'), 'table.csv')).toBe('csv');
  });

  it('refuses web pages and XML, and accepts SVG with a declaration, comments, and a doctype', () => {
    expect(sniffed(text('<!DOCTYPE html><html><body>x</body></html>'), 'page.txt')).toBe('refuse:refused-markup');
    expect(sniffed(text('\n  <html><script>alert(1)</script>'), 'x.svg')).toBe('refuse:refused-markup');
    expect(sniffed(text('<?xml version="1.0"?><note>x</note>'), 'x.svg')).toBe('refuse:refused-markup');
    expect(sniffed(text('<?xml version="1.0"?><xsl:stylesheet/>'), 'x.svg')).toBe('refuse:refused-markup');
    const svg =
      '\ufeff<?xml version="1.0" encoding="UTF-8"?>\n<!-- drawn by hand -->\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n<svg xmlns="http://www.w3.org/2000/svg"/>';
    expect(sniffed(text(svg), 'logo.svg')).toBe('svg');
    expect(rootElementOf('<?xml version="1.0"?>\n<!DOCTYPE html>\n<svg/>')).toEqual({ name: 'svg', doctype: 'html' });
    expect(sniffed(text('<!DOCTYPE html>\n<svg/>'), 'x.svg')).toBe('refuse:refused-markup');
    // As on the server: a prefixed root and a style sheet instruction are not plain drawings.
    expect(sniffed(text('<svg:svg xmlns:svg="http://www.w3.org/2000/svg"/>'), 'x.svg')).toBe('refuse:refused-markup');
    expect(sniffed(text('<?xml version="1.0"?>\n<?xml-stylesheet href="a.xsl"?>\n<svg/>'), 'x.svg')).toBe('refuse:refused-markup');
  });

  it('refuses scripts named as text or data, as the server does', () => {
    expect(sniffed(text('// helper\n/* more */\nexport default function run() {}\n'), 'notes.txt')).toBe('refuse:refused-program');
    expect(sniffed(text("'use strict';\nwindow.x = 1;\n"), 'table.csv')).toBe('refuse:refused-program');
    expect(sniffed(text("import { a } from './a.js';\n"), 'readme')).toBe('refuse:refused-program');
    expect(sniffed(text('const total = 4;\n'), 'notes.txt')).toBe('refuse:refused-program');
    expect(sniffed(text('(function () {\n})();\n'), 'notes.txt')).toBe('refuse:refused-program');
    expect(sniffed(text('/* never closed'), 'notes.txt')).toBe('refuse:refused-program');
    // Words that only look a little like code stay text.
    expect(sniffed(text('Import the data first, then export the table.\n'), 'notes.txt')).toBe('txt');
    expect(sniffed(text('const,let,var\n1,2,3\n'), 'table.csv')).toBe('csv');
    expect(sniffed(text('function of the bracket: hold the motor\n'), 'notes.txt')).toBe('txt');
  });

  it('recognizes the text formats of 3D models and captions', () => {
    expect(sniffed(text('{\n  "asset": { "version": "2.0" },\n  "scenes": []\n}'), 'scene.gltf')).toBe('gltf');
    expect(sniffed(text('solid part\n  facet normal 0 0 1\n    outer loop\n'), 'part.stl')).toBe('stl');
    expect(sniffed(text('# OBJ\nmtllib a.mtl\no Body\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n'), 'body.obj')).toBe('obj');
    expect(sniffed(text('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n'), 'mesh.dat')).toBe('obj');
    expect(sniffed(text('newmtl steel\nKd 0.5 0.5 0.5\n'), 'parts.mtl')).toBe('mtl');
    expect(sniffed(text('ply\nformat ascii 1.0\nelement vertex 3\n'), 'scan.ply')).toBe('ply');
    expect(sniffed(text('ISO-10303-21;\nHEADER;\n'), 'part.STP')).toBe('step');
    expect(sniffed(text('WEBVTT\n\n00:00.000 --> 00:01.000\nHi\n'), 'a.vtt')).toBe('vtt');
    expect(sniffed(text('WEBVTTX\n'), 'a.vtt')).toBe('refuse:vtt-invalid');
    expect(sniffed(text('1\n00:00:01,000 --> 00:00:02,000\nHi\n'), 'a.vtt')).toBe('refuse:vtt-invalid');
  });

  it('recognizes a binary STL by its size, even when its header starts with "solid"', () => {
    const stl = new Uint8Array(84 + 50 * 2);
    stl.set(text('solid exported by a CAD tool'));
    new DataView(stl.buffer).setUint32(80, 2, true);
    expect(sniffed(stl, 'part.stl')).toBe('stl');
    expect(sniffed(stl, 'part.stl', stl.length + 1)).toBe('unknown');
  });

  it('uses the name only where the bytes cannot decide', () => {
    expect(sniffed(text('a,b\n1,2\n'), 'table.csv')).toBe('csv');
    expect(sniffed(text('plain words'), 'notes.txt')).toBe('txt');
    expect(sniffed(text('plain words'), 'notes.md')).toBe('refuse:unsupported-type');
    expect(sniffed(text('%PDF-1.7 is a header'), 'notes.txt')).toBe('pdf');
    expect(sniffed(text('see %PDF-1.7 here'), 'notes.txt')).toBe('txt');
    expect(sniffed(text('\n\n%PDF-1.4\n'), 'paper.pdf')).toBe('pdf');
    const cfb = bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0);
    // Old binary Office files can carry macros nobody can inspect: refused, with a pointer to DOCX or PDF.
    expect(sniffed(cfb, 'old.doc')).toBe('refuse:unsupported-type');
    expect(sniffed(cfb, 'setup.msi')).toBe('refuse:unsupported-type');
    expect(sniffed(bytes('glTF', 1, 0, 0, 0), 'old.glb')).toBe('refuse:unsupported-type');
    expect(sniffed(bytes(0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c), 'a.zip')).toBe('refuse:unsupported-type');
    expect(sniffed(new Uint8Array(0), 'empty.png', 0)).toBe('refuse:empty-file');
  });

  it('decodes text heads and spots binary data', () => {
    expect(textOf(text('\ufeffWEBVTT'))).toBe('WEBVTT');
    expect(textOf(new Uint8Array([0xff, 0xfe, 0x57, 0, 0x45, 0]))).toBe('WE');
    expect(textOf(new Uint8Array([0x41, 0, 0x42]))).toBeNull();
    expect(textOf(new Uint8Array(Array.from({ length: 100 }, (_, i) => (i % 10 === 0 ? 1 : 0x41))))).toBeNull();
  });

  it('tells zip-based formats apart from their entries, and refuses macros', async () => {
    const head = new Uint8Array(0);
    expect(classifyZip(['[Content_Types].xml', 'word/document.xml'], head, 'docx')).toMatchObject({ detected: { format: 'docx' } });
    expect(classifyZip(['xl/workbook.xml'], head, 'zip')).toMatchObject({ detected: { format: 'office', ext: 'xlsx' } });
    expect(classifyZip(['ppt/presentation.xml'], head, 'pptx')).toMatchObject({ detected: { format: 'office', ext: 'pptx' } });
    expect(classifyZip(['3D/3dmodel.model', '_rels/.rels'], head, '3mf')).toMatchObject({ detected: { format: '3mf' } });
    expect(classifyZip(['word/document.xml', 'word/vbaProject.bin'], head, 'docx')).toMatchObject({ kind: 'refuse', code: 'office-macros' });
    expect(classifyZip(['a.txt'], head, 'zip')).toMatchObject({ detected: { format: 'zip' } });
    expect(classifyZip(['a.txt'], head, 'docx')).toMatchObject({ kind: 'refuse', code: 'unknown-type' });
    const odt = await zipOf({ mimetype: 'application/vnd.oasis.opendocument.text', 'content.xml': '<x/>' }, { firstStored: 'mimetype' });
    expect(classifyZip(zipEntryNames(odt) ?? [], odt, 'odt')).toMatchObject({ detected: { format: 'office', ext: 'odt' } });
  });
});

describe('zip directories', () => {
  it('lists the entries of an archive from its central directory', async () => {
    expect(zipEntryNames(sample('document.docx'))).toContain('word/document.xml');
    const archive = await zipOf({ 'a.txt': 'a', 'folder/b.txt': 'b' });
    expect(zipEntryNames(archive)).toEqual(['a.txt', 'folder/', 'folder/b.txt']);
    expect(zipEntryNames(text('not a zip at all'))).toBeNull();
  });

  it('finds the directory behind an archive comment, and rejects a signature inside data', async () => {
    const zip = new JSZip();
    zip.file('a.txt', 'PK\u0005\u0006 inside the data');
    const archive = await zip.generateAsync({ type: 'uint8array', comment: 'a comment at the end' });
    const directory = findCentralDirectory(archive, 0, archive.length);
    expect(directory?.entries).toBe(1);
    expect(findCentralDirectory(archive.subarray(0, archive.length - 3), 0, archive.length - 3)).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------

describe('detect', () => {
  it('refuses the extensions that could run code, whatever the bytes', async () => {
    const error = await expectPrepareError(detect(file(sample('drawing.png'), 'page.HTML')), 'refused-type');
    expect(error.message).toBe(M.refusedExtension('html'));
    await expectPrepareError(detect(file(sample('drawing.svg'), 'drawing.svgz')), 'refused-type');
    await expectPrepareError(detect(file('export default 1', 'module.mjs')), 'refused-type');
  });

  it('refuses empty files, lone companions, and unknown bytes', async () => {
    await expectPrepareError(detect(file(new Uint8Array(0), 'empty.jpg')), 'empty-file');
    await expectPrepareError(detect(file('newmtl a\n', 'parts.mtl')), 'companion-alone');
    await expectPrepareError(detect(file(new Uint8Array([1, 2, 3, 0, 5]), 'scene.bin')), 'companion-alone');
    await expectPrepareError(detect(file(new Uint8Array([1, 2, 3, 0, 5]), 'mystery.dat')), 'unknown-type');
  });

  it('reads zip-based formats through their central directory', async () => {
    const docx = await detect(file(sample('document.docx'), 'Report.docx'));
    expect(docx).toMatchObject({ format: 'docx', ext: 'docx' });
    const xlsx = await zipOf({ '[Content_Types].xml': '<Types/>', 'xl/workbook.xml': '<workbook/>' });
    expect(await detect(file(xlsx, 'Budget.xlsx'))).toMatchObject({ format: 'office', ext: 'xlsx' });
    const plain = await zipOf({ 'readme.txt': 'hello' });
    expect(await detect(file(plain, 'bundle.zip'))).toMatchObject({ format: 'zip', ext: 'zip' });
    const macro = await zipOf({ 'word/document.xml': '<w:document/>', 'word/vbaProject.bin': 'x' });
    await expectPrepareError(detect(file(macro, 'Report.docx')), 'office-macros');
  });
});

// ---------------------------------------------------------------------------------------------

describe('words taken from files', () => {
  it('decodes character references and tidies text', () => {
    expect(decodeEntities('a &amp; b &lt;c&gt; &#233; &#x41; &nbsp;x &bogus;')).toBe('a & b <c> \u00e9 A  x &bogus;');
    expect(tidyText('  one \t two \r\n\r\n\r\n\r\n three  ')).toBe('one two\n\nthree');
  });

  it('reads WebVTT cue text with speakers, and leaves out notes, styles, and timings', () => {
    const vtt = [
      '\ufeffWEBVTT Lecture',
      '',
      'NOTE written by the editor',
      '',
      'STYLE',
      '::cue { color: lime }',
      '',
      'intro',
      '00:00.000 --> 00:02.000 align:start',
      '<v Sam>Hello <b>there</b> &amp; welcome',
      '',
      '00:02.000 --> 00:04.000',
      '<c.loud>Second</c> <00:00:03.000>line',
      'and more',
    ].join('\r\n');
    expect(isWebVtt(vtt)).toBe(true);
    expect(vttCueText(vtt)).toBe('Lecture\nSam: Hello there & welcome\nSecond line\nand more');
    expect(vttCueText('1\n00:00:01,000 --> 00:00:02,000\nx')).toBeNull();
    expect(vttCueText(new TextDecoder().decode(sample('clip.vtt')))).toContain('Sample caption one: the test pattern starts.');
  });

  it('reads the words of an SVG: text, titles, metadata, comments, and label attributes', () => {
    const svg = [
      '<?xml version="1.0"?>',
      '<!-- Created by A. Author -->',
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" sodipodi:docname="bracket.svg">',
      '<title>Bracket</title><desc>Side view</desc>',
      '<metadata><dc:creator>Someone</dc:creator></metadata>',
      '<g inkscape:label="Dimensions" aria-label="Width &amp; height"><text x="1">40 mm</text><tspan>wide</tspan></g>',
      '<style><![CDATA[ .a { fill: none } ]]></style>',
      '</svg>',
    ].join('\n');
    const words = svgText(svg);
    for (const expected of ['Created by A. Author', 'bracket.svg', 'Bracket', 'Side view', 'Someone', 'Dimensions', 'Width & height', '40 mm', 'wide', '.a { fill: none }']) {
      expect(words).toContain(expected);
    }
    expect(words).not.toContain('<');
  });

  it('reads the size of an SVG from its attributes or its viewBox', () => {
    expect(svgSize('<svg width="2400" height="1600">')).toEqual({ width: 2400, height: 1600 });
    expect(svgSize("<svg width='120px' height='40.4px'>")).toEqual({ width: 120, height: 40 });
    expect(svgSize('<svg viewBox="0 0 300 150">')).toEqual({ width: 300, height: 150 });
    expect(svgSize('<svg width="600" viewBox="0,0,300,150">')).toEqual({ width: 600, height: 300 });
    expect(svgSize('<svg width="100%" height="100%">')).toBeNull();
    expect(svgSize('<svg width="10cm" height="5cm" viewBox="0 0 100 50">')).toEqual({ width: 100, height: 50 });
    expect(svgSize(new TextDecoder().decode(sample('drawing.svg')))).toEqual({ width: 2400, height: 1600 });
  });

  it('reads Word parts: paragraphs, tabs, breaks, properties, and link addresses', () => {
    const body =
      '<w:document><w:body><w:p><w:r><w:t>First</w:t><w:tab/><w:t xml:space="preserve">cell </w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>Line</w:t><w:br/><w:t>two &amp; three</w:t></w:r></w:p><w:p/></w:body></w:document>';
    expect(wordXmlText(body)).toBe('First cell\nLine\ntwo & three');
    expect(propertiesXmlText('<?xml version="1.0"?><cp:coreProperties><dc:title>Report</dc:title><dc:creator>A. Author</dc:creator></cp:coreProperties>')).toBe(
      'Report\nA. Author',
    );
    expect(
      externalTargets(
        '<Relationships><Relationship Id="r1" Type=".../hyperlink" Target="https://example.org/a?b=1&amp;c=2" TargetMode="External"/>' +
          '<Relationship Id="r2" Type=".../styles" Target="styles.xml"/></Relationships>',
      ),
    ).toEqual(['https://example.org/a?b=1&c=2']);
  });

  it('reads every word of the sample Word file', async () => {
    const context = createContext('document.docx');
    const prepared = await prepareDocx(file(sample('document.docx'), 'document.docx'), context);
    expect(prepared.kind).toBe('document');
    expect(prepared.mediaKind).toBe('document');
    expect(prepared.parts).toHaveLength(1);
    expect(prepared.parts[0]).toMatchObject({ role: 'main', name: 'document.docx' });
    expect(prepared.meta.text).toContain('Sample Word document');
    expect(prepared.meta.text).toContain('This file tests the Word reader on the samples page.');
    expect(prepared.warnings).toEqual([]);
  });

  it('asks for confirmation when a Word file has no body text', async () => {
    const empty = await zipOf({ 'word/document.xml': '<w:document><w:body><w:p/></w:body></w:document>' });
    const context = createContext('empty.docx');
    const prepared = await prepareDocx(file(empty, 'empty.docx'), context);
    expect(prepared.warnings).toEqual([{ code: 'text-unreadable', message: M.textUnreadable, confirm: true }]);
  });
});

// ---------------------------------------------------------------------------------------------

describe('waveform peaks', () => {
  it('makes 1024 peaks of the loudest absolute sample, normalized and rounded', () => {
    const samples = new Float32Array(48_000);
    for (let i = 0; i < samples.length; i += 1) samples[i] = Math.sin(i / 10) * (i < 24_000 ? 0.25 : -0.5);
    const peaks = peaksOf([samples]);
    expect(peaks).toHaveLength(1024);
    expect(Math.max(...peaks)).toBe(1);
    expect(peaks[0]).toBeCloseTo(0.5, 2);
    expect(peaks.every((peak) => peak >= 0 && peak <= 1 && Math.round(peak * 1000) === peak * 1000)).toBe(true);
  });

  it('takes the louder channel, gives silence zeros, and gives short sounds one peak per sample', () => {
    expect(peaksOf([new Float32Array([0.1, 0.1]), new Float32Array([-0.2, 0.05])], 2)).toEqual([1, 0.5]);
    expect(peaksOf([new Float32Array(4096)])).toEqual(new Array(1024).fill(0));
    expect(peaksOf([new Float32Array([0.5, -1, 0.25])])).toEqual([0.5, 1, 0.25]);
    expect(peaksOf([])).toEqual([]);
    expect(peaksOf([new Float32Array([0.333333, 1])], 2)).toEqual([0.333, 1]);
  });
});

describe('small judgements', () => {
  it('names video codecs by their tag', () => {
    expect(codecTagOf('avc', 'avc1.64001f')).toBe('avc1');
    expect(codecTagOf('hevc', 'hev1.1.6.L93.B0')).toBe('hev1');
    expect(codecTagOf('hevc', null)).toBe('hvc1');
    expect(codecTagOf('vp9', '')).toBe('vp09');
    expect(codecTagOf(null, null)).toBe('unknown');
  });

  it('tells descriptive tags from technical ones', () => {
    expect(descriptiveTagText({ raw: { ENCODER: 'Lavf61', DURATION: '00:00:12' } })).toEqual([]);
    expect(hasPersonalTags({ raw: { ENCODER: 'Lavf61' } })).toBe(false);
    expect(descriptiveTagText({ title: 'Test flight', comment: ' shot at home ', raw: { LOCATION: '+37.3-121.9' } })).toEqual([
      'Test flight',
      'shot at home',
      '+37.3-121.9',
    ]);
    expect(hasPersonalTags({ images: [{ data: new Uint8Array(1), mimeType: 'image/png', kind: 'coverFront' }] })).toBe(true);
    // Each value once; encoder names from ID3 (TSSE) and MP4 ("©too") are not personal.
    expect(descriptiveTagText({ title: 'Voice memo', raw: { '©nam': 'Voice memo', '©too': 'Lavf63.1.101', TSSE: 'Lavf63.1.101' } })).toEqual([
      'Voice memo',
    ]);
    expect(hasPersonalTags({ raw: { TSSE: 'Lavf63.1.101' } })).toBe(false);
  });

  it('takes the poster frame at one second, or a tenth of a shorter video', () => {
    expect(posterTime(120)).toBe(1);
    expect(posterTime(5)).toBe(0.5);
    expect(posterTime(0)).toBe(0);
    expect(posterTime(Number.NaN)).toBe(0);
    expect(posterTime(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('spots drawings: few colors or any transparency', () => {
    const opaque = (colors: number) => {
      const data = new Uint8ClampedArray(4 * 1000);
      for (let i = 0; i < 1000; i += 1) data.set([i % colors, (i * 7) % colors, 0, 255], i * 4);
      return data;
    };
    expect(countColors(opaque(10), 256)).toBeLessThanOrEqual(10);
    expect(looksLikeDrawing(opaque(10), 256)).toBe(true);
    expect(looksLikeDrawing(opaque(1000), 256)).toBe(false);
    const clear = opaque(1000);
    clear[3] = 0;
    expect(hasTransparency(clear)).toBe(true);
    expect(looksLikeDrawing(clear, 256)).toBe(true);
  });

  it('spots a drawing with smoothed edges, whose few main colors cover almost every pixel', () => {
    // 10,000 pixels: 88% paper, 6% ink, and 6% unique edge grays in between (more than 256 colors).
    const pixels = (paint: (i: number) => [number, number, number]) => {
      const data = new Uint8ClampedArray(4 * 10_000);
      for (let i = 0; i < 10_000; i += 1) data.set([...paint(i), 255], i * 4);
      return data;
    };
    const drawing = pixels((i) => (i < 8800 ? [255, 255, 255] : i < 9400 ? [20, 20, 20] : [i % 256, (i >> 8) % 256, 128]));
    expect(countColors(drawing, 256)).toBeGreaterThan(256);
    expect(looksLikeDrawing(drawing, 256)).toBe(true);
    // A photo: colors spread wide, no large flat area.
    let seed = 7;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed >> 16;
    };
    const photo = pixels(() => [next() % 256, next() % 256, next() % 256]);
    expect(countColors(photo, 4096)).toBeGreaterThan(4096);
    expect(looksLikeDrawing(photo, 256)).toBe(false);
  });

  it('checks WebP bytes, so a PNG named .webp is caught', () => {
    expect(isWebPBytes(sample('photo-wide.webp'))).toBe(true);
    expect(isWebPBytes(sample('drawing.png'))).toBe(false);
    expect(isWebPBytes(bytes('RIFF', 0, 0, 0, 0, 'WAVE'))).toBe(false);
  });

  it('keeps one copy of each warning and clamps progress', () => {
    const events: PrepareProgress[] = [];
    const context = createContext('a.jpg', { onProgress: (event) => events.push(event) });
    context.warn('x', 'Same words.', true);
    context.warn('x', 'Same words.', true);
    context.warn('y', 'Other words.');
    expect(context.warnings).toEqual([
      { code: 'x', message: 'Same words.', confirm: true },
      { code: 'y', message: 'Other words.', confirm: false },
    ]);
    context.progress('convert', 1.5);
    context.progress('poster', Number.NaN);
    expect(events).toEqual([
      { file: 'a.jpg', stage: 'convert', fraction: 1 },
      { file: 'a.jpg', stage: 'poster' },
    ]);
  });
});

// ---------------------------------------------------------------------------------------------

/** A worker stand-in: records what it is sent and answers when the test says so. */
class FakeWorker implements WorkerLike {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent | Event) => void) | null = null;
  terminated = false;
  sent: { message: unknown; transfer: Transferable[] }[] = [];
  postMessage(message: unknown, transfer: Transferable[]) {
    this.sent.push({ message, transfer });
  }
  terminate() {
    this.terminated = true;
  }
  answer(data: unknown) {
    this.onmessage?.({ data } as MessageEvent);
  }
}

describe('STEP', () => {
  it('refuses files over 50 MB before reading them', () => {
    expect(() => checkStepSize({ name: 'ok.step', size: STEP_MAX_BYTES })).not.toThrow();
    let error: unknown = null;
    try {
      checkStepSize({ name: 'huge.step', size: STEP_MAX_BYTES + 1 });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(PrepareError);
    expect(error).toMatchObject({ code: 'step-too-large', file: 'huge.step', message: M.stepTooLarge });
  });

  it('sends the bytes to the worker, transfers them, and ends the worker on its answer', async () => {
    const worker = new FakeWorker();
    const buffer = new ArrayBuffer(16);
    const pending = runStepWorker(buffer, { name: 'box.step', createWorker: () => worker, timeoutMs: 1000 });
    expect(worker.sent).toHaveLength(1);
    expect(worker.sent[0].transfer).toEqual([buffer]);
    expect(worker.sent[0].message).toMatchObject({ params: { linearUnit: 'meter' } });
    const result: StepResult = {
      root: { name: '', meshes: [], children: [{ name: 'box', meshes: [0], children: [] }] },
      meshes: [{ name: 'box', color: null, positions: new Float32Array(9), normals: null, indices: new Uint32Array([0, 1, 2]), faces: [] }],
    };
    worker.answer({ ok: true, ...result });
    await expect(pending).resolves.toEqual(result);
    expect(worker.terminated).toBe(true);
  });

  it('stops a worker that takes too long, with the plain message', async () => {
    vi.useFakeTimers();
    try {
      const worker = new FakeWorker();
      const pending = runStepWorker(new ArrayBuffer(4), { name: 'big.step', createWorker: () => worker, timeoutMs: 120_000 });
      const caught = pending.catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(119_999);
      expect(worker.terminated).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      const error = await caught;
      expect(error).toBeInstanceOf(PrepareError);
      expect(error).toMatchObject({ code: 'step-timeout', message: M.stepTimeout });
      expect(worker.terminated).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ends the worker on an abort, a start failure, or an unreadable file', async () => {
    const aborted = new FakeWorker();
    const controller = new AbortController();
    const pending = runStepWorker(new ArrayBuffer(4), { name: 'a.step', createWorker: () => aborted, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(aborted.terminated).toBe(true);

    const failing = new FakeWorker();
    const blocked = runStepWorker(new ArrayBuffer(4), { name: 'b.step', createWorker: () => failing });
    failing.onerror?.(new Event('error'));
    await expectPrepareError(blocked, 'step-blocked');
    expect(failing.terminated).toBe(true);

    const unreadable = new FakeWorker();
    const bad = runStepWorker(new ArrayBuffer(4), { name: 'c.step', createWorker: () => unreadable });
    unreadable.answer({ ok: false, code: 'unreadable', message: 'no' });
    await expectPrepareError(bad, 'step-unreadable');

    const complex = new FakeWorker();
    const heavy = runStepWorker(new ArrayBuffer(4), { name: 'd.step', createWorker: () => complex });
    complex.answer({ ok: false, code: 'complex' });
    const error = await expectPrepareError(heavy, 'step-too-complex');
    expect(error.message).toBe(M.stepTimeout);

    const refused = runStepWorker(new ArrayBuffer(4), {
      name: 'e.step',
      createWorker: () => {
        throw new Error('blocked by policy');
      },
    });
    await expectPrepareError(refused, 'step-blocked');
  });
});

// ---------------------------------------------------------------------------------------------

describe('prepareUploads', () => {
  it('prepares the formats stored as they are, and reports refusals per file', async () => {
    const events: PrepareProgress[] = [];
    const svg = fs.readFileSync(path.join(SAMPLES, 'drawing.svg'));
    const csv = fs.readFileSync(path.join(SAMPLES, 'data.csv'));
    const xlsx = await zipOf({ '[Content_Types].xml': '<Types/>', 'xl/workbook.xml': '<workbook/>' });
    const archive = await zipOf({ 'notes/readme.txt': 'hello' });
    const files = [
      file(svg, 'Drawing One.svg', 'image/svg+xml'),
      file(fs.readFileSync(path.join(SAMPLES, 'clip.vtt')), 'clip.vtt'),
      file(csv, 'data.csv'),
      file(xlsx, 'Budget.xlsx'),
      file(archive, 'bundle.zip'),
      file('<html><body>x</body></html>', 'page.txt'),
      file(sample('drawing.png'), 'script.js'),
      file('newmtl a\n', 'lonely.mtl'),
      file('not captions', 'bad.vtt'),
    ];
    const { prepared, failed } = await prepareUploads(files, { onProgress: (event) => events.push(event) });

    expect(prepared.map((upload) => [upload.original.name, upload.kind, upload.mediaKind])).toEqual([
      ['Drawing One.svg', 'drawing', 'image'],
      ['clip.vtt', 'captions', null],
      ['data.csv', 'file', null],
      ['Budget.xlsx', 'office', null],
      ['bundle.zip', 'file', null],
    ]);
    const [drawing, captions, data, office, zip] = prepared;
    expect(drawing.parts).toEqual([expect.objectContaining({ role: 'main', name: 'Drawing One.svg', contentType: 'image/svg+xml' })]);
    expect(drawing.parts[0].blob.size).toBe(svg.length);
    expect(drawing.meta).toMatchObject({ width: 2400, height: 1600 });
    expect(captions.parts[0]).toMatchObject({ name: 'clip.vtt', contentType: 'text/vtt; charset=utf-8' });
    expect(captions.meta.text).toContain('Sample caption four: the clip ends here.');
    expect(captions.meta.text).not.toContain('-->');
    expect(data.meta.text).toContain(csv.toString('utf8').split('\n')[0].trim());
    expect(office.parts[0]).toMatchObject({ name: 'Budget.xlsx' });
    expect(office.meta.text).toBe('Budget.xlsx');
    expect(office.warnings).toEqual([{ code: 'text-unreadable', message: M.officeTextUnchecked, confirm: true }]);
    expect(zip.meta.text).toContain('notes/readme.txt');
    expect(zip.warnings[0]).toMatchObject({ code: 'archive-unchecked', confirm: true });

    expect(failed.map((error) => [error.file, error.code])).toEqual([
      ['page.txt', 'refused-markup'],
      ['script.js', 'refused-type'],
      ['lonely.mtl', 'companion-alone'],
      ['bad.vtt', 'vtt-invalid'],
    ]);
    expect(failed.every((error) => error instanceof PrepareError && error.message.length > 0)).toBe(true);

    for (const name of files.map((each) => each.name)) {
      const stages = events.filter((event) => event.file === name).map((event) => event.stage);
      expect(stages[0]).toBe('detect');
      expect(stages.at(-1)).toBe('done');
    }
  });

  it('rejects with the abort reason when the signal aborts', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(prepareUploads([file('a,b\n', 'a.csv')], { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });

    const later = new AbortController();
    const files = [file('a,b\n', 'a.csv'), file('c,d\n', 'b.csv')];
    const run = prepareUploads(files, {
      signal: later.signal,
      onProgress: (event) => {
        if (event.file === 'a.csv' && event.stage === 'text') later.abort();
      },
    });
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
  });
});
