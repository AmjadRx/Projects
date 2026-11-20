/**
 * The site's own type for the images, from the repository's font files (app/fonts/, the files
 * next/font serves to the pages): Archivo, made static at the weight and width each role uses on
 * the pages, and B612 Mono. Each face is decoded and instanced once per process, at build time.
 */
import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import { instantiate } from './font/instance';
import { fontMetrics, lineWidth, type FontMetrics } from './font/metrics';
import { writeSfnt, type Font } from './font/sfnt';
import { decodeWoff2 } from './font/woff2';

export type FaceName = 'headline' | 'title' | 'subtitle' | 'mono';

type Weight = 400 | 500 | 700;

interface FaceSpec {
  file: string;
  /** Axis positions for the variable file; the static files have none. */
  axes?: Record<string, number>;
  /** The family name the renderer knows the face by (one name per instance). */
  family: string;
  weight: Weight;
}

/**
 * Each role as the pages set it: the home headline (app/styles/home.css, .hm-hero__title: weight
 * 700, width 125), a project title (app/styles/project.css, .pj-title: 700, 118), a project
 * subtitle (.pj-sub: 500, width 100), and data in B612 Mono (the title block, app/sheet.css 14).
 */
export const FACES: Record<FaceName, FaceSpec> = {
  headline: { file: 'Archivo-Variable.woff2', axes: { wght: 700, wdth: 125 }, family: 'Archivo Headline', weight: 700 },
  title: { file: 'Archivo-Variable.woff2', axes: { wght: 700, wdth: 118 }, family: 'Archivo Title', weight: 700 },
  subtitle: { file: 'Archivo-Variable.woff2', axes: { wght: 500, wdth: 100 }, family: 'Archivo', weight: 500 },
  mono: { file: 'B612Mono-Regular.woff2', family: 'B612 Mono', weight: 400 },
};

export interface Face {
  family: string;
  weight: Weight;
  /** The static font, for drawing outlines directly (lib/og/font/outline.ts). */
  font: Font;
  data: ArrayBuffer;
  metrics: FontMetrics;
  /** A line's width in px at `size`, with `letterSpacing` px after each character. */
  width(text: string, size: number, letterSpacing?: number): number;
}

const FONT_DIR = path.join(process.cwd(), 'app', 'fonts');
const decoded = new Map<string, Font>();
const loaded = new Map<FaceName, Face>();

function decode(file: string): Font {
  let font = decoded.get(file);
  if (!font) {
    font = decodeWoff2(new Uint8Array(fs.readFileSync(path.join(FONT_DIR, file))));
    decoded.set(file, font);
  }
  return font;
}

export function face(name: FaceName): Face {
  const cached = loaded.get(name);
  if (cached) return cached;
  const spec = FACES[name];
  const font = spec.axes ? instantiate(decode(spec.file), spec.axes) : decode(spec.file);
  const bytes = writeSfnt(font);
  const metrics = fontMetrics(font);
  const result: Face = {
    family: spec.family,
    weight: spec.weight,
    font,
    data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    metrics,
    width: (text, size, letterSpacing = 0) => lineWidth(metrics, text, size, letterSpacing),
  };
  loaded.set(name, result);
  return result;
}

/** The fonts option of an ImageResponse, for the faces an image draws with. */
export function rendererFonts(names: readonly FaceName[]): { name: string; data: ArrayBuffer; weight: Weight; style: 'normal' }[] {
  return names.map((name) => {
    const f = face(name);
    return { name: f.family, data: f.data, weight: f.weight, style: 'normal' as const };
  });
}
