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
 *
 * The nav's glass (app/tokens.css, the nav's block; app/sheet.css 1). Photos scroll under the sticky
 * nav and, from 1024 px, under the sheet frame's bands around the window, and lie under the open
 * phone menu's sheet. Over a white one the shared glass comes to #4a5b79, where ink-dim (the nav's
 * links, LinkedIn, GitHub, Search) falls to 3.63 to 1, ink-mute (the hint, "Ctrl K") to 2.31, and
 * line (the menu's LinkedIn and GitHub) to 4.34. So the nav, the menu's sheet and the frame's bands
 * dim what lies under them by half rather than by a third (--nav-glass-dim): never lighter than
 * #3a4a68 behind the words, where ink-dim keeps 4.69 to 1 and line 5.61, while over the dark sky
 * they are all but unchanged. The bands share it so that the top band and the nav just below it
 * stay one glass. In Blueprint the hint (--nav-hint) is ink-dim, the bundle's muted text wherever
 * ink-mute would fall under AA (here it would need a bar near opaque), except on the Light tier,
 * whose nav is the opaque --sheet-2 and keeps ink-mute (4.72 to 1); Whiteprint's nav is the plain
 * white panel, where ink-mute keeps 5.15 to 1. So the nav's and the menu's words are checked below
 * against that glass at its lightest, over pure white. The bands' zone marks belong to the drawing
 * frame, which is hidden from assistive technology, and are left out here as the end-to-end check
 * leaves them out.
 *
 * Why the reasons are here and not in the stylesheets: Next 14 groups the root layout's global CSS
 * into chunks of at most 100 KiB as its loaders leave it, comments included, and the first chunk
 * (the fonts, app/tokens.css, app/globals.css, app/sheet.css) is within a couple of kilobytes of
 * that limit. Past it, the page's first CSS file splits in two: one more request on every page.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { THEMES, type Theme } from '../lib/theme';
import { tokenValue } from '../lib/tokens';
import { contrast, hex, mix, over, parseColor, type Rgb } from './e2e/support/color';

const withoutComments = (file: string) => fs.readFileSync(path.join(__dirname, '..', 'app', file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const SHEET_CSS = withoutComments('sheet.css');
const PALETTE_CSS = withoutComments('palette.css');

/** The declarations of the rule written for exactly `selector` (the first one), or the test fails naming it. */
function ruleFor(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const found = new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  if (!found) throw new Error(`no rule for ${selector}`);
  return found[1];
}

/** The Light tier's rule (app/sheet.css 24): where the page shows the sky, every glass is the plain panel. */
const LIGHT_TIER = ':root[data-sky-tier="light"]:not([data-theme="whiteprint"]):has(.ar-sky[data-background="sky"])';

/** The token the Light tier's rule gives the nav's shortcut hint, or the test fails naming the rule. */
function lightTierHint(): string {
  const m = /--nav-hint:\s*var\(--([\w-]+)\);/.exec(ruleFor(SHEET_CSS, LIGHT_TIER));
  if (!m) throw new Error(`app/sheet.css no longer sets --nav-hint from a token in ${LIGHT_TIER}`);
  return m[1];
}

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

/**
 * The --glass fill over pure white, seen through a backdrop filter whose brightness is the token
 * `dim`: a white photo under the sticky nav, the sheet frame's bands or the open phone menu, at its
 * lightest. The brightness scales the sRGB channels of what lies behind (as Chrome draws it), then
 * the fill is laid over that; the blur cannot make white lighter. In Whiteprint the glass is the
 * opaque white panel, so nothing behind it shows.
 */
function glassOverWhite(theme: Theme, dim: 'glass-dim' | 'nav-glass-dim'): Rgb {
  const value = tokenValue('glass', theme);
  const glass = value ? parseColor(value) : null;
  if (!glass) throw new Error(`--glass (${theme}) is not a color the test can read: ${value}`);
  const brightness = Number(tokenValue(dim, theme));
  if (!(brightness > 0 && brightness <= 1)) throw new Error(`--${dim} is not a brightness from 0 to 1: ${tokenValue(dim, theme)}`);
  return over(glass.rgb, glass.alpha, [255 * brightness, 255 * brightness, 255 * brightness]);
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
  // The sticky nav and the open phone menu with a white photo under them (app/tokens.css, the nav's
  // block): the name, the current link, a hovered one, Menu and Close are ink; the other links,
  // LinkedIn, GitHub, Search and the menu's theme words ink-dim; the shortcut hint --nav-hint; the
  // menu's current link and its LinkedIn and GitHub links line. And the hint on the other surfaces
  // the nav takes: glass over the plain sheet (the grid and plain backgrounds), the plain panel
  // (Whiteprint's glass), and in Blueprint the Light tier's opaque panel, --sheet-2, where the hint
  // is the token that tier's rule gives it (app/sheet.css 24).
  const navOverWhite: [string, Rgb] = ["the nav's glass over white", glassOverWhite(theme, 'nav-glass-dim')];
  for (const name of ['ink', 'ink-dim', 'nav-hint', 'line']) text(`--${name}`, t(name), ...navOverWhite);
  out.push({ text: '--line (focus ring)', on: navOverWhite[0], fg: t('line'), bg: navOverWhite[1], least: 3 });
  for (const [on, bg] of surfaces) text('--nav-hint', t('nav-hint'), on, bg);
  if (theme === 'blueprint') {
    const hint = lightTierHint();
    text(`--nav-hint (the Light tier's, --${hint})`, t(hint), "--sheet-2 (the Light tier's nav)", t('sheet-2'));
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

  it("draws the nav, the phone menu's sheet and the sheet frame's bands on the nav's glass, and the hint in --nav-hint, as the pairs above take them", () => {
    // The nav's backdrop filter: the shared blur with the nav's own brightness; none in Whiteprint
    // (its glass is the opaque white panel) and none on the Light tier, whose glass is --sheet-2,
    // where nothing shows through the nav and the hint keeps the bundle's ink-mute.
    expect(SHEET_CSS).toMatch(/:root, \[data-theme\] \{[^}]*--nav-glass-filter: blur\(var\(--glass-blur\)\) brightness\(var\(--nav-glass-dim\)\);/);
    expect(SHEET_CSS).toMatch(/\[data-theme="whiteprint"\] \{[^}]*--nav-glass-filter: none;/);
    const light = ruleFor(SHEET_CSS, LIGHT_TIER);
    for (const declaration of ['--glass: var(--sheet-2);', '--glass-filter: none;', '--nav-glass-filter: none;', '--nav-hint: var(--ink-mute);']) {
      expect(light, LIGHT_TIER).toContain(declaration);
    }
    // The top band sits just above the sticky nav from 1024 px: on another glass the two would part
    // in two tones over a photo.
    for (const selector of ['.ar-nav', '.ar-mmenu__sheet', '.ar-sheetframe__band']) {
      const rule = ruleFor(SHEET_CSS, selector);
      expect(rule, selector).toContain('background-color: var(--glass);');
      expect(rule, selector).toContain('-webkit-backdrop-filter: var(--nav-glass-filter);');
      expect(rule, selector).toMatch(/(^|[;\s])backdrop-filter: var\(--nav-glass-filter\);/);
    }
    expect(ruleFor(PALETTE_CSS, '.ar-nav__kbd')).toContain('color: var(--nav-hint);');
    // The model, against what Chrome drew: with the shared dim, the glass over a white photo is the
    // #4a5b79 that the end-to-end contrast check measured behind the nav's words before the nav had
    // a dim of its own (tests/e2e/contrast.spec.ts).
    expect(hex(glassOverWhite('blueprint', 'glass-dim'))).toBe('#4a5b79');
    expect(hex(glassOverWhite('blueprint', 'nav-glass-dim'))).toBe('#3a4a68');
    expect(hex(glassOverWhite('whiteprint', 'nav-glass-dim'))).toBe('#ffffff');
  });

  it('computes as WCAG does: black on white is 21 to 1, a color on itself 1 to 1', () => {
    expect(contrast([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
    expect(contrast([127, 151, 191], [127, 151, 191])).toBe(1);
    expect(parseColor('color(srgb 1 0.5 0 / 0.7)')).toEqual({ rgb: [255, 127.5, 0], alpha: 0.7 });
    expect(parseColor('rgba(15, 42, 90, 0.62)')).toEqual({ rgb: [15, 42, 90], alpha: 0.62 });
    expect(parseColor('#0b1f45')).toEqual({ rgb: [11, 31, 69], alpha: 1 });
  });
});
