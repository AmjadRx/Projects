/**
 * Both themes pass AA contrast (ARCHITECTURE.md 15, item 3; DESIGN_DIRECTION.md 8: "WCAG AA
 * contrast in both themes, checked for every text and line token"), on the tokens themselves: each
 * text token on each surface the site sets text on, read from app/tokens.css (lib/tokens.ts) and,
 * for the night well's inks, from app/sheet.css. axe checks the colors it can resolve on the pages,
 * and tests/e2e/contrast.spec.ts the text over the sky and its glass, which axe cannot; this file
 * keeps the token pairs from drifting, whatever page uses them.
 *
 * The Light tier of the sky (phones, tablets and low-power machines) makes every glass panel the
 * plain panel color (app/sheet.css 24, R-06), so the text on its panels has exactly the contrast of
 * the tokens on --sheet-2 checked here.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { THEMES, type Theme } from '../lib/theme';
import { tokenValue } from '../lib/tokens';
import { contrast, hex, mix, over, parseColor, type Rgb } from './e2e/support/color';

const SHEET_CSS = fs.readFileSync(path.join(__dirname, '..', 'app', 'sheet.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** A token's color in a theme, opaque, or the test fails naming it. */
function token(name: string, theme: Theme): Rgb {
  const value = tokenValue(name, theme);
  const color = value ? parseColor(value) : null;
  if (!color) throw new Error(`--${name} (${theme}) is not a color the test can read: ${value}`);
  if (color.alpha < 1) throw new Error(`--${name} (${theme}) is not opaque: ${value}`);
  return color.rgb;
}

/** The night well's dim ink: app/sheet.css mixes it from --on-night and --night. */
function onNightDim(theme: Theme): Rgb {
  const m = /--on-night-dim:\s*color-mix\(in srgb, var\(--on-night\) (\d+)%, var\(--night\)\);/.exec(SHEET_CSS);
  if (!m) throw new Error('app/sheet.css no longer mixes --on-night-dim from --on-night and --night');
  return mix(token('on-night', theme), Number(m[1]) / 100, token('night', theme));
}

/** The night well's line color: --line in Blueprint, --on-night in Whiteprint (app/sheet.css 1). */
function nightLine(theme: Theme): Rgb {
  const blueprint = /:root, \[data-theme\] \{[^}]*--night-line: var\(--line\);/.test(SHEET_CSS);
  const whiteprint = /\[data-theme="whiteprint"\] \{[^}]*--night-line: var\(--on-night\);/.test(SHEET_CSS);
  if (!blueprint || !whiteprint) throw new Error('app/sheet.css no longer sets --night-line from --line and --on-night');
  return theme === 'whiteprint' ? token('on-night', theme) : token('line', theme);
}

/** The glass fill over the plain sheet, where the page shows no sky (the flat grid, or the plain sheet). */
function glassOverSheet(theme: Theme): Rgb {
  const value = tokenValue('glass', theme);
  const glass = value ? parseColor(value) : null;
  if (!glass) throw new Error(`--glass (${theme}) is not a color the test can read: ${value}`);
  return over(glass.rgb, glass.alpha, token('sheet', theme));
}

interface Pair {
  text: string;
  on: string;
  fg: Rgb;
  bg: Rgb;
  /** 4.5 for text (1.4.3), 3 for a component's edge or a focus ring (1.4.11). */
  least: number;
}

function pairs(theme: Theme): Pair[] {
  const t = (name: string) => token(name, theme);
  const out: Pair[] = [];
  const text = (name: string, fg: Rgb, on: string, bg: Rgb) => out.push({ text: name, on, fg, bg, least: 4.5 });
  // Headings, body, secondary text, labels and links on the page, the panels, and glass over the sheet.
  const surfaces: [string, Rgb][] = [
    ['--sheet', t('sheet')],
    ['--sheet-2', t('sheet-2')],
    ['--glass over --sheet', glassOverSheet(theme)],
  ];
  for (const [on, bg] of surfaces) for (const name of ['ink', 'ink-dim', 'ink-mute', 'line']) text(`--${name}`, t(name), on, bg);
  // The raised surface: pressed and active controls (a filter, a viewer's view, the palette's lit
  // row, whose meta moves from ink-mute to ink-dim there: app/palette.css).
  for (const name of ['ink', 'ink-dim', 'line']) text(`--${name}`, t(name), '--sheet-3', t('sheet-3'));
  // The primary button's words on its fill.
  text('--on-action', t('on-action'), '--action', t('action'));
  // The night well behind photos, video and viewers: its words, its dim words and its links.
  text('--on-night', t('on-night'), '--night', t('night'));
  text('--on-night-dim', onNightDim(theme), '--night', t('night'));
  text('--night-line', nightLine(theme), '--night', t('night'));
  // Edges a visitor must see (1.4.11): the focus ring and drawn lines, and the phantom-line edge of
  // a control that cannot act yet and of an unreached maturity step.
  for (const [on, bg] of surfaces) {
    out.push({ text: '--line (focus ring)', on, fg: t('line'), bg, least: 3 });
    out.push({ text: '--ink-mute (phantom edge)', on, fg: t('ink-mute'), bg, least: 3 });
  }
  return out;
}

describe('the tokens pass AA contrast in both themes', () => {
  for (const theme of THEMES) {
    it(`${theme}: every text token on every surface it is set on`, () => {
      const failing = pairs(theme)
        .map((p) => ({ ...p, ratio: contrast(p.fg, p.bg) }))
        .filter((p) => p.ratio < p.least)
        .map((p) => `${p.text} ${hex(p.fg)} on ${p.on} ${hex(p.bg)}: ${p.ratio.toFixed(2)} to 1, under ${p.least}`);
      expect(failing).toEqual([]);
    });
  }

  it('reads the token values the design gives (DESIGN_DIRECTION.md 2.1 and 2.2)', () => {
    expect(hex(token('ink-mute', 'blueprint'))).toBe('#7f97bf');
    expect(hex(token('ink-mute', 'whiteprint'))).toBe('#5b6e90');
    // The design's own figure: ink-mute is 5.3 to 1 (or better) on the Blueprint sheet.
    expect(contrast(token('ink-mute', 'blueprint'), token('sheet', 'blueprint'))).toBeGreaterThanOrEqual(5.3);
  });

  it('computes as WCAG does: black on white is 21 to 1, a color on itself 1 to 1', () => {
    expect(contrast([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
    expect(contrast([127, 151, 191], [127, 151, 191])).toBe(1);
    expect(parseColor('color(srgb 1 0.5 0 / 0.7)')).toEqual({ rgb: [255, 127.5, 0], alpha: 0.7 });
    expect(parseColor('rgba(15, 42, 90, 0.62)')).toEqual({ rgb: [15, 42, 90], alpha: 0.62 });
    expect(parseColor('#0b1f45')).toEqual({ rgb: [11, 31, 69], alpha: 1 });
  });
});
