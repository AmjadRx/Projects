/**
 * The pages' font files (public/fonts/, written with app/fonts.css and lib/fontFiles.ts by
 * scripts/subset-fonts.py from the full files in app/fonts/): each face's core and extended files
 * hold, between them, every character of the full file and none twice; each @font-face rule names
 * exactly its file's characters (unicode-range), so a browser fetches the extended file only for a
 * character in it and never misses a glyph; every file a rule names exists, and nothing else is in
 * the folder; the core files hold every character the content uses; the preloaded files are the
 * core files the rules name; and Archivo keeps its weight axis and the widths the stylesheets set.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FONT_PRELOADS } from '../lib/fontFiles';
import { readAxes } from '../lib/og/font/instance';
import { fontMetrics } from '../lib/og/font/metrics';
import { decodeWoff2 } from '../lib/og/font/woff2';

const root = path.resolve(__dirname, '..');
const read = (...parts: string[]) => new Uint8Array(fs.readFileSync(path.join(root, ...parts)));

/** The code points a font file maps to a glyph (the site's fonts have none past the BMP). */
function charactersOf(bytes: Uint8Array): Set<number> {
  const { glyphOf } = fontMetrics(decodeWoff2(bytes));
  const out = new Set<number>();
  for (let cp = 0; cp <= 0xffff; cp += 1) if (glyphOf(cp) !== 0) out.add(cp);
  return out;
}

/** A unicode-range value as code points: "U+20-7E, U+A0" and so on. */
function rangeCharacters(range: string): Set<number> {
  const out = new Set<number>();
  for (const part of range.split(',').map((p) => p.trim())) {
    const match = /^U\+([0-9A-F]+)(?:-([0-9A-F]+))?$/i.exec(part);
    if (!match) throw new Error(`not a unicode-range part: ${part}`);
    const lo = parseInt(match[1], 16);
    const hi = match[2] ? parseInt(match[2], 16) : lo;
    for (let cp = lo; cp <= hi; cp += 1) out.add(cp);
  }
  return out;
}

/** The web font rules of app/fonts.css (the fallback faces use local fonts and are left out). */
function rules(): { family: string; url: string; weight: string; range: string }[] {
  const css = fs.readFileSync(path.join(root, 'app', 'fonts.css'), 'utf8');
  return [...css.matchAll(/@font-face \{([^}]*)\}/g)]
    .map(([, body]) => ({
      family: /font-family: "([^"]+)"/.exec(body)?.[1] ?? '',
      url: /src: url\("([^"]+)"\)/.exec(body)?.[1] ?? '',
      weight: /font-weight: ([^;]+);/.exec(body)?.[1] ?? '',
      range: /unicode-range: ([^;]+);/.exec(body)?.[1] ?? '',
    }))
    .filter((rule) => rule.url !== '');
}

const fileOf = (url: string) => {
  expect(url.startsWith('/fonts/')).toBe(true);
  return read('public', url);
};
const sameSet = (a: Set<number>, b: Set<number>) => a.size === b.size && [...a].every((cp) => b.has(cp));

describe('the subset font files', () => {
  const faces = [
    { full: 'Archivo-Variable.woff2', family: 'Archivo Site', weight: '100 900' },
    { full: 'B612Mono-Regular.woff2', family: 'B612 Mono Site', weight: '400' },
    { full: 'B612Mono-Bold.woff2', family: 'B612 Mono Site', weight: '700' },
  ];

  it('names a core and an extended file for each face, each holding exactly its unicode-range', () => {
    const all = rules();
    expect(all).toHaveLength(6);
    for (const rule of all) expect(sameSet(rangeCharacters(rule.range), charactersOf(fileOf(rule.url))), rule.url).toBe(true);
    // Every file in public/fonts/ is one a rule names.
    const named = all.map((rule) => rule.url.replace('/fonts/', '')).sort();
    expect(fs.readdirSync(path.join(root, 'public', 'fonts')).sort()).toEqual(named);
  });

  it.each(faces)('$full: the two files hold every character of the full file, none twice', ({ full, family, weight }) => {
    const [core, ext] = rules().filter((rule) => rule.family === family && rule.weight === weight);
    const a = charactersOf(fileOf(core.url));
    const b = charactersOf(fileOf(ext.url));
    expect([...a].filter((cp) => b.has(cp))).toEqual([]);
    expect(sameSet(new Set([...a, ...b]), charactersOf(read('app', 'fonts', full)))).toBe(true);
  });

  it('the core files hold every character the content uses, and are the files the pages preload', () => {
    const used = new Set<number>();
    const walk = (value: unknown): void => {
      if (typeof value === 'string') for (const ch of value) used.add(ch.codePointAt(0)!);
      else if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === 'object') Object.values(value).forEach(walk);
    };
    const content = path.join(root, 'content');
    walk(JSON.parse(fs.readFileSync(path.join(content, 'site.json'), 'utf8')));
    for (const file of fs.readdirSync(path.join(content, 'projects')).filter((f) => f.endsWith('.json'))) {
      walk(JSON.parse(fs.readFileSync(path.join(content, 'projects', file), 'utf8')));
    }
    // Line breaks and tabs are white space the pages never draw as glyphs.
    for (const cp of [0x09, 0x0a]) used.delete(cp);
    const cores = rules().filter((rule) => rule.url.includes('-core.'));
    expect(FONT_PRELOADS).toEqual(cores.filter((rule) => rule.weight !== '700').map((rule) => rule.url));
    for (const url of FONT_PRELOADS) {
      const has = charactersOf(fileOf(url));
      expect([...used].filter((cp) => !has.has(cp)).map((cp) => cp.toString(16)), url).toEqual([]);
    }
  });

  it("keeps Archivo's whole weight axis and the widths the stylesheets set, 100 to 125", () => {
    for (const rule of rules().filter((r) => r.family === 'Archivo Site')) {
      const axes = readAxes(decodeWoff2(fileOf(rule.url)));
      expect(axes.map(({ tag, min, def, max }) => [tag, min, def, max])).toEqual([
        ['wght', 100, 600, 900],
        ['wdth', 100, 100, 125],
      ]);
    }
  });
});
