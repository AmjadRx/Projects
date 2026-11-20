/**
 * The command palette's logic (components/palette/model.ts): the filter and its highlights, what
 * each key does, and the state that typing and the keys move through (the WAI-ARIA combobox with a
 * listbox, inside the palette's modal dialog).
 */
import { describe, expect, it } from 'vitest';
import {
  activeResult,
  matchLabel,
  paletteKey,
  paletteStep,
  PALETTE_START,
  queryWords,
  searchPalette,
  type PaletteKeyEvent,
} from '../components/palette/model';
import type { PaletteIndex } from '../lib/palette';

/** The shape of the seed's index, as the Palette boards group it. */
const INDEX: PaletteIndex = {
  groups: [
    {
      label: 'Pages',
      items: [
        { label: 'Home', meta: 'Page', href: '/' },
        { label: 'Projects', meta: 'Page', href: '/projects' },
        { label: 'Build log', meta: 'Page', href: '/log' },
        { label: 'Contact', meta: 'Page', href: '/contact' },
      ],
    },
    {
      label: 'Projects',
      items: [
        { label: 'SCU Pegasus: Design-Build-Vertical Flight', meta: 'Sheet 1 of 12', href: '/projects/dbvf-senior-design' },
        { label: 'Raven', meta: 'Sheet 2 of 12', href: '/projects/raven' },
        { label: 'Pipelined CPU in Verilog', meta: 'Sheet 11 of 12', href: '/projects/pipelined-cpu-verilog' },
      ],
    },
    {
      label: 'Sections',
      items: [
        { label: 'SCU Pegasus: Design-Build-Vertical Flight: My part: the electrical system', meta: 'Section', href: '/projects/dbvf-senior-design#db-b' },
        { label: 'Raven: Structure and analysis', meta: 'Section', href: '/projects/raven#rv-c' },
        { label: 'Raven: Roadmap', meta: 'Section', href: '/projects/raven#rv-e' },
        { label: 'Raven: Build photos', meta: 'Section', href: '/projects/raven#rv-h' },
      ],
    },
  ],
  pages: ['Projects', 'Build log', 'Contact'],
};

const labels = (query: string) => searchPalette(INDEX, query).groups.map((g) => [g.label, g.items.map((i) => i.label)]);
const key = (k: string, mods: Partial<PaletteKeyEvent> = {}): PaletteKeyEvent => ({
  key: k,
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...mods,
});

describe('the filter', () => {
  it('lists everything, in the index order, before anything is typed', () => {
    const results = searchPalette(INDEX, '');
    expect(results.flat).toHaveLength(11);
    expect(results.flat.map((r) => r.n)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(results.flat.every((r) => r.hits.length === 0)).toBe(true);
    expect(searchPalette(INDEX, '   ').flat).toHaveLength(11);
  });

  it('finds what the 1440 board shows for "rav": Raven, then its three sections, no page', () => {
    expect(labels('rav')).toEqual([
      ['Projects', ['Raven']],
      ['Sections', ['Raven: Structure and analysis', 'Raven: Roadmap', 'Raven: Build photos']],
    ]);
  });

  it('finds what the long-title board shows for "peg": the project and its one section', () => {
    expect(labels('peg')).toEqual([
      ['Projects', ['SCU Pegasus: Design-Build-Vertical Flight']],
      ['Sections', ['SCU Pegasus: Design-Build-Vertical Flight: My part: the electrical system']],
    ]);
  });

  it('ignores case, and matches every word in any order', () => {
    expect(labels('RAVEN road')).toEqual([['Sections', ['Raven: Roadmap']]]);
    expect(labels('road raven')).toEqual([['Sections', ['Raven: Roadmap']]]);
    expect(labels('design build')).toEqual(labels('peg'));
    expect(labels('raven nothing')).toEqual([]);
  });

  it('keeps pages first, so "log" opens the build log before a title that holds the letters', () => {
    expect(labels('log')).toEqual([
      ['Pages', ['Build log']],
      ['Projects', ['Pipelined CPU in Verilog']],
    ]);
  });

  it('numbers the results across groups, as the arrow keys count them', () => {
    expect(searchPalette(INDEX, 'rav').flat.map((r) => [r.n, r.label])).toEqual([
      [0, 'Raven'],
      [1, 'Raven: Structure and analysis'],
      [2, 'Raven: Roadmap'],
      [3, 'Raven: Build photos'],
    ]);
  });

  it('reads the query literally, so pattern characters find nothing they should not', () => {
    expect(labels('.*')).toEqual([]);
    expect(labels('(')).toEqual([]);
    expect(labels('Design-Build')).toEqual(labels('peg'));
    expect(matchLabel('a+b', 'a+b')).toEqual([{ start: 0, end: 3 }]);
  });

  it('finds nothing for a query that matches nothing', () => {
    const results = searchPalette(INDEX, 'zzz');
    expect(results.flat).toEqual([]);
    expect(results.groups).toEqual([]);
  });
});

describe('the highlight', () => {
  it('marks the query where the label holds it as typed, as the bundle marks it', () => {
    expect(matchLabel('Raven: Roadmap', 'rav')).toEqual([{ start: 0, end: 3 }]);
    expect(matchLabel('Raven: Roadmap', 'Raven: R')).toEqual([{ start: 0, end: 8 }]);
    expect(matchLabel('SCU Pegasus: Design-Build-Vertical Flight', 'peg')).toEqual([{ start: 4, end: 7 }]);
  });

  it('marks the first place of each word otherwise, in label order, joining stretches that touch', () => {
    expect(matchLabel('Raven: Roadmap', 'road raven')).toEqual([
      { start: 0, end: 5 },
      { start: 7, end: 11 },
    ]);
    expect(matchLabel('Build log', 'bui uil')).toEqual([{ start: 0, end: 4 }]);
  });

  it('marks nothing for an empty query, and answers null when a word is missing', () => {
    expect(matchLabel('Raven', '')).toEqual([]);
    expect(matchLabel('Raven', 'raven x')).toBeNull();
  });

  it('splits the query at white space', () => {
    expect(queryWords('  raven \t road  ')).toEqual(['raven', 'road']);
    expect(queryWords('   ')).toEqual([]);
  });
});

describe('the keys', () => {
  it('moves with Down and Up, opens with Enter, closes with Escape, and keeps Tab inside', () => {
    expect(paletteKey(key('ArrowDown'))).toBe('next');
    expect(paletteKey(key('ArrowUp'))).toBe('previous');
    expect(paletteKey(key('Enter'))).toBe('go');
    expect(paletteKey(key('Escape'))).toBe('close');
    expect(paletteKey(key('Tab'))).toBe('tab');
    expect(paletteKey(key('Tab', { shiftKey: true }))).toBe('tab');
  });

  it('leaves every other key, and these with a modifier, to the field and the browser', () => {
    for (const k of ['a', 'Home', 'End', 'PageDown', 'ArrowLeft', 'ArrowRight', 'Backspace', ' ']) expect(paletteKey(key(k)), k).toBeNull();
    expect(paletteKey(key('ArrowUp', { shiftKey: true }))).toBeNull();
    expect(paletteKey(key('ArrowDown', { altKey: true }))).toBeNull();
    expect(paletteKey(key('Enter', { ctrlKey: true }))).toBeNull();
    expect(paletteKey(key('Enter', { metaKey: true }))).toBeNull();
    expect(paletteKey(key('Enter', { shiftKey: true }))).toBeNull();
    expect(paletteKey(key('Tab', { ctrlKey: true }))).toBeNull();
  });

  it('leaves every key to an input method while it composes, Escape and Enter included', () => {
    for (const k of ['Escape', 'Enter', 'ArrowDown', 'Tab']) expect(paletteKey(key(k, { isComposing: true })), k).toBeNull();
  });
});

describe('the state', () => {
  it('starts empty, with the first result active', () => {
    expect(PALETTE_START).toEqual({ query: '', active: 0 });
  });

  it('makes the first result active again whenever the query changes', () => {
    const moved = paletteStep(paletteStep(PALETTE_START, { type: 'next', count: 5 }), { type: 'next', count: 5 });
    expect(moved.active).toBe(2);
    expect(paletteStep(moved, { type: 'query', query: 'r' })).toEqual({ query: 'r', active: 0 });
  });

  it('steps round the list: Down from the last goes to the first, Up from the first to the last', () => {
    let state = PALETTE_START;
    state = paletteStep(state, { type: 'previous', count: 4 });
    expect(state.active).toBe(3);
    state = paletteStep(state, { type: 'next', count: 4 });
    expect(state.active).toBe(0);
    state = paletteStep(state, { type: 'next', count: 4 });
    expect(state.active).toBe(1);
  });

  it('does nothing on the arrows when nothing matches, and follows the pointer', () => {
    expect(paletteStep({ query: 'zzz', active: 0 }, { type: 'next', count: 0 })).toEqual({ query: 'zzz', active: 0 });
    expect(paletteStep(PALETTE_START, { type: 'point', n: 3 }).active).toBe(3);
  });

  it('keeps an active place past the end of a shorter list inside it', () => {
    expect(paletteStep({ query: 'x', active: 9 }, { type: 'next', count: 3 }).active).toBe(0);
    const results = searchPalette(INDEX, 'rav');
    expect(activeResult(results, { query: 'rav', active: 9 })?.label).toBe('Raven: Build photos');
    expect(activeResult(searchPalette(INDEX, 'zzz'), { query: 'zzz', active: 0 })).toBeNull();
  });

  it('runs the path of the 1440 board: type "rav", Down twice, and the active result is the roadmap', () => {
    let state = paletteStep(PALETTE_START, { type: 'query', query: 'rav' });
    const results = searchPalette(INDEX, state.query);
    state = paletteStep(state, { type: 'next', count: results.flat.length });
    state = paletteStep(state, { type: 'next', count: results.flat.length });
    expect(activeResult(results, state)?.href).toBe('/projects/raven#rv-e');
  });
});
