// @vitest-environment jsdom
/**
 * The save bar's status line (components/admin/shell/StatusText.tsx; DESIGN_DIRECTION.md 6.4,
 * motion sheet 8.3, ARCHITECTURE.md 8): the admin's one motion. The words a line mounts with show
 * as they are; new words scramble in through Motion+ ScrambleText's engine (replaced here by a
 * recorder, so each scramble can be finished by hand) over the new words, which hold the layout;
 * a screen reader hears only final words, once, from one live region; under reduced motion every
 * change shows at once. The scramble keeps to one line, drawn from the new words' own characters,
 * and words that wrap are set at once (lines never re-break in motion). And the admin's code
 * imports no Motion library: only scrambleText.
 */
import fs from 'node:fs';
import path from 'node:path';
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scrambleCharsOf, settleAfter, StatusText, type StatusTone } from '../components/admin/shell/StatusText';
import { admin, dur } from '../lib/motion';

vi.mock('next/navigation', () => ({ usePathname: () => '/admin' }));

interface Scramble {
  element: HTMLElement;
  /** What the element held when the engine took it: the words it scrambles into. */
  words: string;
  options: { chars?: unknown; duration?: unknown; interval?: unknown; onComplete?: () => void };
  stopped: boolean;
}

const engine = vi.hoisted(() => ({ runs: [] as Scramble[] }));

vi.mock('motion-plus', () => ({
  scrambleText: (element: HTMLElement, options: Scramble['options']) => {
    const run: Scramble = { element, words: element.textContent ?? '', options, stopped: false };
    engine.runs.push(run);
    return { stop: () => (run.stopped = true), play() {}, finish() {}, finished: Promise.resolve() };
  },
}));

/** The reduced-motion setting the page reads, and whoever listens for its changes. */
const reduced = { matches: false, listeners: new Set<() => void>() };

let container: HTMLDivElement;
let root: Root;

const draw = (text: string, tone: StatusTone = 'idle') => act(() => root.render(h(StatusText, { text, tone })));
/** The line's text box: the live copy, the drawn words, and the scramble while it runs. */
const parts = () => {
  const [spoken, drawn, scramble] = Array.from(container.querySelector('.adm-status__text')!.children) as HTMLElement[];
  return { spoken, drawn, scramble };
};
const liveRegions = () => container.querySelectorAll('[aria-live]');

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  engine.runs.length = 0;
  reduced.matches = false;
  reduced.listeners.clear();
  window.matchMedia = ((query: string) => ({
    matches: query.includes('reduce') ? reduced.matches : false,
    media: query,
    onchange: null,
    addEventListener: (_type: string, listener: () => void) => reduced.listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => reduced.listeners.delete(listener),
    addListener: (listener: () => void) => reduced.listeners.add(listener),
    removeListener: (listener: () => void) => reduced.listeners.delete(listener),
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('the save bar status line', () => {
  it('shows the words it mounts with as they are, read from one live region', () => {
    draw('No unsaved changes');
    const { spoken, drawn, scramble } = parts();
    expect(engine.runs).toHaveLength(0);
    expect(scramble).toBeUndefined();
    expect(liveRegions()).toHaveLength(1);
    expect(spoken.getAttribute('aria-live')).toBe('polite');
    expect(spoken.getAttribute('aria-atomic')).toBe('true');
    expect(spoken.className).toBe('adm-sr');
    expect(spoken.textContent).toBe('No unsaved changes');
    expect(drawn.getAttribute('aria-hidden')).toBe('true');
    expect(drawn.hasAttribute('data-scrambling')).toBe(false);
    expect(drawn.textContent).toBe('No unsaved changes');
    // The line itself is no longer the live region: only the stable copy is.
    expect(container.querySelector('.adm-status')?.hasAttribute('aria-live')).toBe(false);
  });

  it('scrambles into new words over the new words, which hold the layout, then settles', () => {
    draw('No unsaved changes');
    draw('Unsaved changes in 1 file', 'dirty');
    const { spoken, drawn, scramble } = parts();
    // A screen reader hears the final words at once, and only them.
    expect(spoken.textContent).toBe('Unsaved changes in 1 file');
    expect(liveRegions()).toHaveLength(1);
    // The drawn words are the new ones from the first paint, unpainted under the scramble.
    expect(drawn.textContent).toBe('Unsaved changes in 1 file');
    expect(drawn.hasAttribute('data-scrambling')).toBe(true);
    expect(scramble.getAttribute('aria-hidden')).toBe('true');
    expect(scramble.hasAttribute('aria-live')).toBe(false);

    expect(engine.runs).toHaveLength(1);
    const [run] = engine.runs;
    expect(run.element).toBe(scramble);
    expect(run.words).toBe('Unsaved changes in 1 file');
    expect(run.options.duration).toBe(settleAfter);
    expect(run.options.interval).toBe(admin.status.interval);
    // It scrambles through the new words' own characters, so it stays about as wide as they are.
    expect(run.options.chars).toEqual(Array.from('Unsavedchangesin1file'));

    act(() => run.options.onComplete?.());
    expect(parts().scramble).toBeUndefined();
    expect(parts().drawn.hasAttribute('data-scrambling')).toBe(false);
    expect(parts().drawn.textContent).toBe('Unsaved changes in 1 file');
    expect(run.stopped).toBe(true);
  });

  it('starts again from the newest words when they change mid-scramble', () => {
    draw('Unsaved changes in 1 file', 'dirty');
    draw('Saving', 'busy');
    draw('Saved as commit abc1234.', 'ok');
    expect(engine.runs.map((run) => run.words)).toEqual(['Saving', 'Saved as commit abc1234.']);
    expect(engine.runs[0].stopped).toBe(true);
    expect(engine.runs[1].stopped).toBe(false);
    expect(parts().spoken.textContent).toBe('Saved as commit abc1234.');
    // The first scramble finishing late changes nothing.
    act(() => engine.runs[0].options.onComplete?.());
    expect(parts().scramble).toBeDefined();
    act(() => engine.runs[1].options.onComplete?.());
    expect(parts().scramble).toBeUndefined();
  });

  it('keeps the same words still: a new tone alone does not scramble', () => {
    draw('Saved.', 'ok');
    draw('Saved.', 'idle');
    expect(engine.runs).toHaveLength(0);
  });

  it('sets words that wrap at once: a scramble on them would re-break the line', () => {
    draw('No unsaved changes');
    // The new words take two lines (jsdom lays nothing out, so their line boxes are given here).
    const twoLines = [
      { x: 0, y: 0, width: 300, height: 21 },
      { x: 0, y: 21, width: 120, height: 21 },
    ];
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue(twoLines as unknown as DOMRectList);
    const long = 'Not saved: the content check found 3 problems in content/projects/raven.json and stopped the save.';
    draw(long, 'error');
    expect(engine.runs).toHaveLength(0);
    expect(parts().scramble).toBeUndefined();
    expect(parts().drawn.hasAttribute('data-scrambling')).toBe(false);
    expect(parts().drawn.textContent).toBe(long);
    expect(parts().spoken.textContent).toBe(long);
  });

  it('sets words with nothing to scramble at once', () => {
    draw('No unsaved changes');
    draw('   ', 'error');
    expect(engine.runs).toHaveLength(0);
    expect(parts().scramble).toBeUndefined();
    expect(parts().drawn.hasAttribute('data-scrambling')).toBe(false);
  });

  it('changes the words at once under reduced motion, and stops a scramble when it is switched on', () => {
    reduced.matches = true;
    draw('No unsaved changes');
    draw('Unsaved changes in 2 files', 'dirty');
    expect(engine.runs).toHaveLength(0);
    expect(parts().scramble).toBeUndefined();
    expect(parts().drawn.hasAttribute('data-scrambling')).toBe(false);
    expect(parts().drawn.textContent).toBe('Unsaved changes in 2 files');

    // Allowed again: the next change scrambles.
    reduced.matches = false;
    act(() => reduced.listeners.forEach((listener) => listener()));
    expect(engine.runs).toHaveLength(0);
    draw('Saving', 'busy');
    expect(engine.runs).toHaveLength(1);

    // Switched on mid-scramble: the scramble goes and the words show at once.
    reduced.matches = true;
    act(() => reduced.listeners.forEach((listener) => listener()));
    expect(engine.runs[0].stopped).toBe(true);
    expect(parts().scramble).toBeUndefined();
    expect(parts().drawn.hasAttribute('data-scrambling')).toBe(false);
    expect(parts().drawn.textContent).toBe('Saving');
  });
});

describe('the scramble on one line (StatusText.module.css)', () => {
  it("draws from the words' own characters, as often as they occur, spaces left out", () => {
    expect(scrambleCharsOf('Saving')).toEqual(['S', 'a', 'v', 'i', 'n', 'g']);
    expect(scrambleCharsOf('Saved as commit abc1234.').join('')).toBe('Savedascommitabc1234.');
    // A character beyond the basic plane stays whole.
    expect(scrambleCharsOf('Saved \u{1F680}')).toEqual(['S', 'a', 'v', 'e', 'd', '\u{1F680}']);
    expect(scrambleCharsOf(' \t ')).toEqual([]);
  });

  it('keeps the scramble on one line, unclipped, over the words from where they start', () => {
    const css = fs.readFileSync(path.resolve('components/admin/shell/StatusText.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const scramble = /\.scramble \{([\s\S]*?)\}/.exec(css)?.[1] ?? '';
    expect(scramble).toContain('position: absolute;');
    expect(scramble).toContain('inset: 0;');
    expect(scramble).toContain('white-space: nowrap;');
    expect(scramble).not.toMatch(/overflow/);
  });
});

describe('the scramble timing (lib/motion.ts admin.status)', () => {
  it('borrows the scale: settling left to right from dur.short to dur.line', () => {
    expect(admin.status).toEqual({ settleFirst: dur.short, settleLast: dur.line, interval: 0.05 });
  });

  it('settles the first character first and the last within 400 ms, whatever the length', () => {
    for (const length of [2, 6, 24, 140]) {
      expect(settleAfter(0, length)).toBeCloseTo(dur.short, 12);
      expect(settleAfter(length - 1, length)).toBeCloseTo(dur.line, 12);
      for (let index = 1; index < length; index += 1) expect(settleAfter(index, length)).toBeGreaterThan(settleAfter(index - 1, length));
    }
    expect(settleAfter(0, 1)).toBe(dur.short);
  });
});

describe('what /admin loads of Motion (ARCHITECTURE.md 8)', () => {
  /** Every TypeScript source under a folder. */
  function sources(folder: string): string[] {
    return fs.readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) return sources(file);
      return /\.tsx?$/.test(entry.name) ? [file] : [];
    });
  }
  const importsOf = (file: string) => Array.from(fs.readFileSync(file, 'utf8').matchAll(/from '([^']+)'/g), (match) => match[1]);

  it('takes only the scramble from Motion+, and no Motion library', () => {
    const status = fs.readFileSync(path.resolve('components/admin/shell/StatusText.tsx'), 'utf8');
    expect(status).toMatch(/^import \{ scrambleText \} from 'motion-plus';$/m);
    for (const file of [...sources(path.resolve('components/admin')), ...sources(path.resolve('lib/admin'))]) {
      for (const source of importsOf(file)) {
        expect([file, source]).not.toEqual([file, 'motion/react']);
        expect([file, source]).not.toEqual([file, 'motion']);
        expect([file, source]).not.toEqual([file, 'framer-motion']);
        expect([file, source]).not.toEqual([file, 'motion-plus/react']);
      }
    }
  });
});
