/**
 * The printed page (app/print.css; ARCHITECTURE.md 5, "Also new"; the canvas's Print board and its
 * print.css): every rule is for print, the stylesheet loads last, the paper and inks come from
 * app/tokens.css and are the same in both themes, the interactive chrome and all motion stay on
 * screen, and a project page is one Letter landscape drawing sheet whose added words (the owner's
 * name, the page address, the label over the highlights) come from the page's data-print-*
 * attributes. Printing itself is checked in Chrome (page.pdf) during the phase; this file keeps
 * the rules from drifting.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import TitleBlock from '../components/sheet/TitleBlock';
import { makeLinkResolver } from '../lib/links';
import { UI } from '../lib/strings';
import type { Project } from '../lib/types';

// The project page's client parts read the route and the router.
vi.mock('next/navigation', async (load) => ({
  ...(await load<typeof import('next/navigation')>()),
  usePathname: () => '/projects/raven',
  useRouter: () => ({ push: () => undefined, back: () => undefined }),
}));

const ROOT = path.resolve(__dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const RAW = read('app/print.css');
const PRINT = stripComments(RAW);

/** One numbered section of the stylesheet (its comment heading to the next), comments removed. */
function section(n: number): string {
  const start = RAW.indexOf(`/* ---------- ${n}. `);
  if (start < 0) throw new Error(`no section ${n}`);
  const next = RAW.indexOf(`/* ---------- ${n + 1}. `, start);
  return stripComments(RAW.slice(start, next < 0 ? undefined : next));
}
const TOKENS = stripComments(read('app/tokens.css'));

/** Every innermost rule of the stylesheet: its selectors and its declarations. */
const RULES = [...PRINT.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
  selectors: m[1]
    .replace(/@media print\s*/, '')
    .split(',')
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean),
  body: m[2],
}));

/** The declarations of the first rule whose whole selector list is `selector`. */
function rule(selector: string): string {
  const found = RULES.find((r) => r.selectors.length === 1 && r.selectors[0] === selector);
  if (!found) throw new Error(`no rule for ${selector}`);
  return found.body;
}

/** The selectors of the first rule that holds `declaration`. */
function selectorsOf(declaration: string): string[] {
  const found = RULES.find((r) => r.body.includes(declaration));
  if (!found) throw new Error(`no rule holds ${declaration}`);
  return found.selectors;
}

function readJson(file: string): any {
  return JSON.parse(read(file));
}

const raven = readJson('content/projects/raven.json') as Project;
const moonlamp = readJson('content/projects/moonlamp.json') as Project;
const site = readJson('content/site.json');

describe('the print stylesheet', () => {
  it('holds every rule inside one @media print block', () => {
    const text = PRINT.trim();
    expect(text.startsWith('@media print {')).toBe(true);
    let depth = 0;
    let closedAt = -1;
    for (let i = 0; i < text.length; i += 1) {
      if (text[i] === '{') depth += 1;
      if (text[i] === '}') {
        depth -= 1;
        if (depth === 0) {
          closedAt = i;
          break;
        }
      }
    }
    expect(closedAt).toBe(text.length - 1);
  });

  it('loads last, after every other stylesheet of the site', () => {
    const imports = [...read('app/layout.tsx').matchAll(/^import '\.\/([^']+\.css)';$/gm)].map((m) => m[1]);
    expect(imports.at(-1)).toBe('print.css');
    expect(imports.filter((name) => name === 'print.css')).toHaveLength(1);
  });

  it('writes no color of its own: every ink and the paper are print tokens from app/tokens.css', () => {
    expect(PRINT).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(PRINT).not.toMatch(/\b(rgba?|hsla?|oklch|color-mix)\(/i);
    const used = new Set([...PRINT.matchAll(/var\(--(print-[\w-]+)\)/g)].map((m) => m[1]));
    const defined = new Set([...TOKENS.matchAll(/--(print-[\w-]+)\s*:/g)].map((m) => m[1]));
    expect([...used].sort()).toEqual([...defined].sort());
    // lib/tokens.ts reads the theme tables from app/tokens.css; the print tokens join the base
    // table under their own names and change no theme token.
    expect(TOKENS).not.toMatch(/@media print/);
  });

  it('prints both themes alike: the same paper and inks for Blueprint and Whiteprint', () => {
    const selectors = selectorsOf('--sheet: var(--print-paper);');
    expect(selectors).toEqual(expect.arrayContaining(['html', "html[data-theme='blueprint']", "html[data-theme='whiteprint']"]));
    const tokens = RULES.find((r) => r.selectors.includes("html[data-theme='whiteprint']"))!.body;
    for (const [name, value] of [
      ['--sheet', 'var(--print-paper)'],
      ['--sheet-2', 'var(--print-paper)'],
      ['--night', 'var(--print-paper)'],
      ['--ink', 'var(--print-ink)'],
      ['--ink-dim', 'var(--print-ink-dim)'],
      ['--ink-mute', 'var(--print-ink-mute)'],
      ['--line', 'var(--print-line)'],
      ['--rule', 'var(--print-rule)'],
      ['--glass', 'var(--print-paper)'],
      ['--glass-filter', 'none'],
      ['--on-night', 'var(--print-ink)'],
    ]) {
      expect(tokens, name).toContain(`${name}: ${value};`);
    }
    expect(tokens).toContain('color-scheme: light;');
  });

  it('leaves the interactive chrome off the paper', () => {
    const hidden = selectorsOf('display: none !important;');
    for (const selector of [
      '.ar-skip',
      '.ar-sky',
      '.ar-nav',
      '.ar-mmenu',
      '.ar-heat',
      '.ar-sheetframe',
      '.ar-cmdk',
      '.ar-lightbox',
      'dialog',
      "[role='dialog']",
      '.ar-foot__pause',
      '.ar-filter',
      '.ar-btn',
      '.ar-iconbtn',
      '.ar-theme',
      '.ar-dim__zoom',
      '.st-contact__actions',
      '.pj-back',
      '.pj-pager',
      'video',
      'canvas',
      'iframe',
    ]) {
      expect(hidden, selector).toContain(selector);
    }
  });

  it('stops every animation and transition, and shows what waits for a script', () => {
    const still = RULES.find((r) => r.selectors.includes('*') && r.selectors.includes('*::after'))!.body;
    expect(still).toContain('animation: none !important;');
    expect(still).toContain('transition: none !important;');
    expect(selectorsOf('stroke-dashoffset: 0 !important;')).toContain('.hd-draw');
    expect(selectorsOf('opacity: 1 !important;')).toEqual(expect.arrayContaining(['.hm-hero__title', '.mm-poster', '.ar-well > img']));
  });

  it('draws no thermal ramp of its own (DESIGN_DIRECTION.md 2.4)', () => {
    expect(PRINT).not.toMatch(/--t[0-6]\b|--heat/);
  });

  it('keeps panels, figures, cards and table rows whole on a page', () => {
    const whole = RULES.find((r) => r.selectors.includes('.ar-card') && r.body.includes('break-inside: avoid;'));
    expect(whole?.selectors).toEqual(expect.arrayContaining(['.ar-card', '.ar-well', 'figure', 'img', 'tr', '.ar-tb', '.ar-tl__item']));
  });
});

describe('the project sheet (the Print board)', () => {
  it('is one Letter landscape page with no margin, for the project page only', () => {
    expect(PRINT).toMatch(/@page sheet \{\s*size: 11in 8\.5in;\s*margin: 0;\s*\}/);
    expect(rule('.ar-frame:has(.pj-sheet)')).toContain('page: sheet;');
  });

  it('draws the frame 40 px in, with the zone band, and the working area 72 px in: 912 by 672 px in two columns', () => {
    expect(rule('.ar-frame:has(.pj-sheet) .ar-sheetframe')).toContain('inset: 40px;');
    const sheet = rule('.pj-sheet');
    expect(sheet).toContain('grid-template-columns: 456px 432px;');
    expect(sheet).toContain('column-gap: 24px;');
    expect(sheet).toContain('width: 912px;');
    expect(sheet).toContain('height: 672px;');
    expect(sheet).toContain('margin: 72px 0 0 72px;');
  });

  it("takes the words it adds from the page's data-print-* attributes", () => {
    expect(rule('.pj-sheet::after')).toContain('content: attr(data-print-address);');
    expect(rule('.pj-sheet::after')).toMatch(/right: 64px;[\s\S]*bottom: 41px;/);
    expect(rule('.pj-sheet .pj-head::before')).toContain('content: attr(data-print-owner);');
    expect(rule('.pj-sheet .pj-hl::before')).toContain('content: attr(data-print-label);');
    // No word of its own: every content property is an attribute or empty.
    const contents = [...PRINT.matchAll(/(?:^|[\s{;])content:\s*([^;]+);/g)].map((m) => m[1]);
    expect(contents.length).toBeGreaterThan(3);
    for (const value of contents) expect(value).toMatch(/^(attr\(data-print-[a-z]+\)|''|none)$/);
  });

  it('sets nothing on the sheet under 12 px', () => {
    const sizes = [...section(5).matchAll(/font-size:\s*([\d.]+)px/g)].map((m) => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(10);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(12);
  });

  it("keeps the other pages' table rules off the sheet's revision table", () => {
    // A general rule for .ar-rev after section 5 would override the sheet's own (one found while
    // building: /log's cell padding misaligned the sheet's rows).
    const general = [...section(6).matchAll(/([^{}]+)\{[^{}]*\}/g)]
      .flatMap((m) => m[1].split(','))
      .map((s) => s.replace(/\s+/g, ' ').trim())
      .filter((s) => s.includes('.ar-rev'));
    expect(general.length).toBeGreaterThan(0);
    for (const selector of general) expect(selector, selector).toMatch(/^\.st-log /);
  });

  it('prints the revision table, the specifications and the title block, and leaves the other blocks on screen', () => {
    expect(selectorsOf('order: -1;')).toContain(".pj-sheet .pj-blocks > [data-block='log']");
    expect(PRINT).toContain(".pj-sheet .pj-blocks > :not([data-block='specTable']):not([data-block='log'])");
    expect(rule('.pj-sheet .pj-rail')).toContain('align-self: end;');
  });
});

describe('the project page carries what the sheet prints', () => {
  it('marks the article as the sheet, with the address, the owner, and the label over the highlights', async () => {
    const { default: ProjectPage } = await import('../app/(site)/projects/[slug]/page');
    const html = renderToStaticMarkup(await ProjectPage({ params: Promise.resolve({ slug: 'raven' }) }));
    expect(html).toMatch(/<article class="pj-sheet" data-print-address="amjadrehawi\.com\/projects\/raven">/);
    expect(html).toContain(`<header class="pj-head" data-print-owner="${site.personal.name}">`);
    expect(html).toContain(`<ul class="pj-hl ar-glass" data-print-label="${UI.print.notes}">`);
    // The cover's row of readouts, which the sheet draws over the cover, holds every callout in order.
    const row = /<ul class="ar-dim__row"[^>]*>([\s\S]*?)<\/ul>/.exec(html)?.[1] ?? '';
    const pairs = [...row.matchAll(/<span class="ar-dim__value">([^<]*)<\/span><span class="ar-dim__label">([^<]*)<\/span>/g)].map((m) => `${m[2]} ${m[1]}`);
    expect(pairs).toEqual((raven.callouts ?? []).map((c) => `${c.label} ${c.value}`));
  }, 120_000);
});

describe('the title block names each field', () => {
  const resolve = makeLinkResolver(new Set(['raven', 'moonlamp']), { siteHosts: ['amjadrehawi.com'], phoneShown: true });

  function cells(html: string): string[] {
    return [...html.matchAll(/<div class="ar-tb__cell([^"]*)">/g)].map((m) => m[1].trim());
  }

  it('gives every cell its field, so the sheet can place it', () => {
    const html = renderToStaticMarkup(h(TitleBlock, { project: raven, sheet: 2, sheets: 12, rev: '2026-11-17', resolveLink: resolve, rail: true }));
    expect(cells(html)).toEqual([
      'ar-tb__cell--project',
      'ar-tb__cell--sheet ar-tb__cell--end',
      'ar-tb__cell--role ar-tb__cell--wide',
      'ar-tb__cell--dates ar-tb__cell--wide',
      'ar-tb__cell--status',
      'ar-tb__cell--rev ar-tb__cell--end',
      'ar-tb__cell--maturity ar-tb__cell--wide',
    ]);
  });

  it('leaves out a field the content does not give, and STATUS takes the row without REV', () => {
    const html = renderToStaticMarkup(h(TitleBlock, { project: moonlamp, sheet: 5, sheets: 12, resolveLink: resolve }));
    const names = cells(html);
    expect(names).toContain('ar-tb__cell--status ar-tb__cell--wide');
    expect(names.some((n) => n.includes('--rev'))).toBe(false);
    expect(names.at(-1)).toBe('ar-tb__cell--links ar-tb__cell--wide');
  });
});
