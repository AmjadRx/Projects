// @vitest-environment jsdom
/**
 * The headline's line reveal (DESIGN_DIRECTION.md 6.2 step 2 and 6.4; motion sheet 2.3 and 2.4;
 * components/home/hero/Headline.tsx and headlineReveal.ts): split by line with Motion+ splitText
 * after hydration, React's own text node back when it ends, once a visit through lib/intro.ts, and
 * the CSS start state and give-up. jsdom lays nothing out, so each test gives the words a layout:
 * a top for each word's range before the split (Range.getClientRects) and for its span after it
 * (offsetTop, which splitText reads), a top for each line's span, the h1's height before and after
 * the split, and Element.animate is a stand-in the test finishes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { StrictMode, act, createElement } from 'react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cssEasing, load, toMs } from '../lib/motion';

const state = vi.hoisted(() => ({ motionOk: true, paused: false }));

vi.mock('next/navigation', () => ({ usePathname: () => '/', useRouter: () => ({ prefetch: () => {} }) }));
vi.mock('../lib/useMotionOk', () => ({ useMotionOk: () => state.motionOk }));
vi.mock('../lib/motionPause', () => ({ useMotionPaused: () => state.paused }));

const { default: Headline } = await import('../components/home/hero/Headline');
const {
  LINE_CLASS,
  SET_ATTR,
  WORD_CLASS,
  lineReveal,
  linesFromTops,
  revealHeadline,
  revealWanted,
  rowsKept,
  sameLines,
  splittable,
} = await import('../components/home/hero/headlineReveal');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TEXT = 'Hardware engineer for things that move themselves.';
/** Three lines, as the 1440 board sets it: "Hardware engineer" / "for things that" / "move themselves." */
const LINES = [0, 0, 1, 1, 1, 2, 2];
const LINE_HEIGHT = 57;

async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

type FakeAnimation = { finished: Promise<unknown>; cancel: () => void; finish: () => void; cancelled: boolean };
let animations: { el: Element; keyframes: Keyframe[]; options: KeyframeAnimationOptions; animation: FakeAnimation }[] = [];

/** jsdom's own getBoundingClientRect on HTMLElement.prototype, if it has one there, to put back. */
const ownRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');

/**
 * A layout for the words: `before` gives each word's line in the text, `after` in the split (by
 * default the same), `rows` each line span's row (by default its own, top down), and `heights` the
 * h1's height before and after the split (by default the text's rows, both). Element.animate
 * records its calls and returns animations the test finishes.
 */
function layout({
  before = LINES,
  after = before,
  rows,
  heights,
}: { before?: number[]; after?: number[]; rows?: number[]; heights?: [number, number] } = {}) {
  const textHeight = (Math.max(...before) + 1) * LINE_HEIGHT;
  const [heightBefore, heightAfter] = heights ?? [textHeight, textHeight];
  (Range.prototype as unknown as { getClientRects: () => DOMRect[] }).getClientRects = function getClientRects(this: Range) {
    const text = this.startContainer.textContent ?? '';
    const word = text.slice(0, this.startOffset).split(' ').length - 1;
    return [{ top: before[word] * LINE_HEIGHT, height: LINE_HEIGHT, width: 40, left: 0 } as DOMRect];
  };
  Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
    configurable: true,
    get(this: HTMLElement) {
      const index = Number(this.dataset.index);
      if (this.classList.contains(WORD_CLASS)) return after[index] * LINE_HEIGHT;
      if (this.classList.contains(LINE_CLASS)) return (rows?.[index] ?? index) * LINE_HEIGHT;
      return 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    writable: true,
    value(this: HTMLElement) {
      const height = this.tagName !== 'H1' ? 0 : this.querySelector(`.${LINE_CLASS}`) ? heightAfter : heightBefore;
      return { top: 0, left: 0, right: 0, bottom: height, width: 0, height, x: 0, y: 0, toJSON() {} } as DOMRect;
    },
  });
  (Element.prototype as unknown as { animate: unknown }).animate = function animate(this: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
    let resolve!: (value: unknown) => void;
    let reject!: (error: unknown) => void;
    const finished = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    finished.catch(() => {});
    const animation: FakeAnimation = {
      finished,
      cancelled: false,
      cancel() {
        animation.cancelled = true;
        reject(new Error('AbortError'));
      },
      finish() {
        resolve(animation);
      },
    };
    animations.push({ el: this, keyframes, options, animation });
    return animation;
  };
}

function clearLayout() {
  delete (Range.prototype as unknown as { getClientRects?: unknown }).getClientRects;
  delete (HTMLElement.prototype as unknown as { offsetTop?: unknown }).offsetTop;
  if (ownRect) Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', ownRect);
  else delete (HTMLElement.prototype as unknown as { getBoundingClientRect?: unknown }).getBoundingClientRect;
  delete (Element.prototype as unknown as { animate?: unknown }).animate;
  animations = [];
}

/** An h1 holding the headline as one text node, in a hero section. */
function heading(text = TEXT) {
  const section = document.createElement('section');
  section.className = 'hm-hero';
  const h1 = document.createElement('h1');
  h1.className = 'hm-hero__title';
  h1.textContent = text;
  section.append(h1);
  document.body.append(section);
  return { section, h1, node: h1.firstChild };
}

const linesOf = (h1: Element) =>
  Array.from(h1.querySelectorAll(`.${LINE_CLASS}`), (line) => Array.from(line.querySelectorAll(`.${WORD_CLASS}`), (word) => word.textContent).join(' '));

afterEach(() => {
  clearLayout();
  document.body.replaceChildren();
  document.documentElement.removeAttribute('data-intro-seen');
  document.documentElement.removeAttribute('data-motion-paused');
  sessionStorage.clear();
});

describe('the rules', () => {
  it('splits only plain text: words parted by single spaces, nothing HTML would read', () => {
    expect(splittable(TEXT)).toBe(true);
    expect(splittable('One')).toBe(true);
    // A no-break space keeps two words together and is part of one word here.
    expect(splittable(`June${String.fromCharCode(0xa0)}2027 ready`)).toBe(true);
    for (const text of ['', ' lead', 'trail ', 'two  spaces', 'line\nbreak', 'tab\there', 'R&D', 'a <b>bold</b> one']) {
      expect(splittable(text), JSON.stringify(text)).toBe(false);
    }
  });

  it('plays while the load sequence plays and before the give-up (load.headline.giveUpAfter)', () => {
    const giveUp = toMs(load.headline.giveUpAfter);
    expect(giveUp).toBe(1200);
    expect(revealWanted(null)).toBe(false);
    expect(revealWanted(0)).toBe(true);
    expect(revealWanted(giveUp - 1)).toBe(true);
    expect(revealWanted(giveUp)).toBe(false);
  });

  it('moves each line as sheet 2.3 has it: 0.35 em up to its place, opacity 0 to 1, 400 ms, settle, 60 ms apart', () => {
    for (const index of [0, 1, 2, 4]) {
      const { keyframes, options } = lineReveal(index);
      expect(keyframes).toEqual([
        { opacity: 0, transform: `translateY(${load.headline.rise}em)` },
        { opacity: 1, transform: 'none' },
      ]);
      expect(options).toEqual({
        duration: toMs(load.headline.duration),
        delay: index * toMs(load.headline.step),
        easing: cssEasing(load.headline.ease),
        fill: 'both',
      });
    }
    expect([load.headline.rise, toMs(load.headline.duration), toMs(load.headline.step)]).toEqual([0.35, 400, 60]);
    expect(cssEasing(load.headline.ease)).toBe('cubic-bezier(0.2, 0.7, 0.2, 1)');
  });

  it('reads lines from the words tops, with a tolerance for glyphs of other heights', () => {
    expect(linesFromTops([], 8)).toEqual([]);
    expect(linesFromTops([100, 100.4, 157, 157, 214], 8)).toEqual([0, 0, 1, 1, 2]);
    expect(linesFromTops([100, 105, 100], 8)).toEqual([0, 0, 0]);
  });

  it('accepts a split only when it holds every word, in order, on its own line', () => {
    expect(sameLines(LINES, [[0, 1], [2, 3, 4], [5, 6]])).toBe(true);
    expect(sameLines(LINES, [[0, 1, 2], [3, 4], [5, 6]])).toBe(false);
    expect(sameLines(LINES, [[0, 1], [2, 3, 4], [5]])).toBe(false);
    expect(sameLines(LINES, [[1, 0], [2, 3, 4], [5, 6]])).toBe(false);
    expect(sameLines([0], [[0]])).toBe(true);
  });
});

describe('revealHeadline: split by line, play, and give React its text node back', () => {
  it('splits the lines the text has, never into letters, and keeps the full headline as the label', () => {
    layout();
    const { h1 } = heading();
    const reveal = revealHeadline(h1);
    expect(reveal).not.toBeNull();
    expect(linesOf(h1)).toEqual(['Hardware engineer', 'for things that', 'move themselves.']);
    expect(h1.querySelectorAll('.split-char, [class*="char"]')).toHaveLength(0);
    expect(h1.getAttribute('aria-label')).toBe(TEXT);
    // The h1 is still the one h1, and reads as the whole headline.
    expect(document.querySelectorAll('h1')).toHaveLength(1);
    expect(h1.textContent?.replace(/\s+/g, ' ').trim()).toBe(TEXT);
    reveal?.stop();
  });

  it('starts each line with its own animation, 60 ms apart', () => {
    layout();
    const { h1 } = heading();
    revealHeadline(h1);
    const lines = Array.from(h1.querySelectorAll(`.${LINE_CLASS}`));
    expect(animations.map(({ el }) => el)).toEqual(lines);
    expect(animations.map(({ options }) => options.delay)).toEqual([0, 60, 120]);
    for (const [index, call] of animations.entries()) expect(call).toMatchObject(lineReveal(index));
  });

  it('when the last line has set, puts back the very text node React rendered, and the label goes', async () => {
    layout();
    const { h1, node } = heading();
    revealHeadline(h1);
    for (const { animation } of animations.slice(0, -1)) animation.finish();
    await flush();
    expect(h1.querySelectorAll(`.${LINE_CLASS}`)).toHaveLength(3);
    animations.at(-1)!.animation.finish();
    await flush();
    expect(Array.from(h1.childNodes)).toEqual([node]);
    expect(h1.firstChild).toBe(node);
    expect(h1.hasAttribute('aria-label')).toBe(false);
  });

  it('stop() ends it at once in its final state', () => {
    layout();
    const { h1, node } = heading();
    const reveal = revealHeadline(h1)!;
    reveal.stop();
    expect(animations.every(({ animation }) => animation.cancelled)).toBe(true);
    expect(Array.from(h1.childNodes)).toEqual([node]);
    expect(h1.hasAttribute('aria-label')).toBe(false);
    reveal.stop();
  });

  it('does not play when the split would set the lines differently: the text stays as it is', () => {
    layout({ before: LINES, after: [0, 0, 0, 1, 1, 2, 2] });
    const { h1, node } = heading();
    expect(revealHeadline(h1)).toBeNull();
    expect(Array.from(h1.childNodes)).toEqual([node]);
    expect(h1.hasAttribute('aria-label')).toBe(false);
    expect(animations).toHaveLength(0);
  });

  it('sets each line as a block, so no two lines can share a row while it plays', () => {
    layout();
    const { h1 } = heading();
    const reveal = revealHeadline(h1);
    expect(reveal).not.toBeNull();
    const lines = Array.from(h1.querySelectorAll<HTMLElement>(`.${LINE_CLASS}`));
    expect(lines).toHaveLength(3);
    for (const line of lines) expect(line.style.display).toBe('block');
    reveal?.stop();
  });

  it('does not play when two lines would share a row: the text stays as it is', () => {
    layout({ rows: [0, 0, 1] });
    const { h1, node } = heading();
    expect(revealHeadline(h1)).toBeNull();
    expect(Array.from(h1.childNodes)).toEqual([node]);
    expect(h1.hasAttribute('aria-label')).toBe(false);
    expect(animations).toHaveLength(0);
  });

  it('does not play when the split would change the height of the h1: nothing below it may shift', () => {
    layout({ heights: [3 * LINE_HEIGHT, 2 * LINE_HEIGHT] });
    const { h1, node } = heading();
    expect(revealHeadline(h1)).toBeNull();
    expect(Array.from(h1.childNodes)).toEqual([node]);
    expect(animations).toHaveLength(0);
  });

  it('reads the rows from the split: each line below the one before, and the height within rounding', () => {
    layout();
    const { h1 } = heading();
    const reveal = revealHeadline(h1)!;
    const lines = Array.from(h1.querySelectorAll<HTMLElement>(`.${LINE_CLASS}`));
    const height = 3 * LINE_HEIGHT;
    expect(rowsKept(h1, lines, height)).toBe(true);
    expect(rowsKept(h1, lines, height + 0.4)).toBe(true);
    expect(rowsKept(h1, lines, height + 1)).toBe(false);
    expect(rowsKept(h1, [lines[1], lines[0], lines[2]], height)).toBe(false);
    expect(rowsKept(h1, [lines[0]], height)).toBe(true);
    reveal.stop();
  });

  it('does not play for a word broken across two lines, for text that is not plain, or without Web Animations', () => {
    layout();
    (Range.prototype as unknown as { getClientRects: () => DOMRect[] }).getClientRects = () =>
      [{ top: 0, height: LINE_HEIGHT, width: 40, left: 0 }, { top: LINE_HEIGHT, height: LINE_HEIGHT, width: 40, left: 0 }] as DOMRect[];
    const broken = heading('A hyphenated-word');
    expect(revealHeadline(broken.h1)).toBeNull();
    expect(broken.h1.firstChild).toBe(broken.node);

    layout();
    const markup = heading('R&D lead');
    expect(revealHeadline(markup.h1)).toBeNull();
    expect(markup.h1.firstChild).toBe(markup.node);

    layout();
    delete (Element.prototype as unknown as { animate?: unknown }).animate;
    const old = heading();
    expect(revealHeadline(old.h1)).toBeNull();
    expect(old.h1.firstChild).toBe(old.node);
  });
});

describe('Headline: one h1, hydrated as the server sent it, revealed once a visit', () => {
  let root: Root | null = null;

  beforeEach(() => {
    state.motionOk = true;
    state.paused = false;
    window.matchMedia = ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  });

  afterEach(() => {
    const r = root;
    if (r) act(() => r.unmount());
    root = null;
    vi.restoreAllMocks();
  });

  it('renders the h1 exactly as before the reveal existed', () => {
    expect(renderToString(createElement(Headline, { text: TEXT }))).toBe(`<h1 class="hm-hero__title" id="hero-title">${TEXT}</h1>`);
  });

  /**
   * The page as the browser has it before React: the hero section with the server's h1, and, when
   * the load sequence plays, data-intro set `age` ms ago by the section's inline script.
   */
  function page(age: number | null) {
    const section = document.createElement('section');
    section.className = 'hm-hero';
    if (age !== null) section.setAttribute('data-intro', String(Math.round(performance.now() - age)));
    const container = document.createElement('div');
    container.innerHTML = renderToString(createElement(Headline, { text: TEXT }));
    section.append(container);
    document.body.append(section);
    const serverH1 = container.querySelector('h1')!;
    const serverText = serverH1.firstChild;
    return { section, container, serverH1, serverText };
  }

  /** Hydrates the server's h1, inside StrictMode when `strict` (development's doubled effects). */
  function hydrate(container: HTMLElement, strict = false) {
    const errors: unknown[] = [];
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const headline = createElement(Headline, { text: TEXT });
    act(() => {
      root = hydrateRoot(container, strict ? createElement(StrictMode, null, headline) : headline, {
        onRecoverableError: (error) => errors.push(error),
      });
    });
    const warnings = consoleError.mock.calls.filter((call) => /hydrat|did not match|server/i.test(String(call[0])));
    return { errors, warnings };
  }

  it('while the load sequence plays: hydrates with no mismatch, then splits the server h1 and starts the lines', async () => {
    layout();
    const { section, container, serverH1, serverText } = page(100);
    const { errors, warnings } = hydrate(container);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
    expect(container.querySelector('h1')).toBe(serverH1);
    expect(serverH1.hasAttribute(SET_ATTR)).toBe(true);
    expect(linesOf(serverH1)).toEqual(['Hardware engineer', 'for things that', 'move themselves.']);
    expect(animations).toHaveLength(3);
    // The visit is marked, so the home page plays it once.
    expect(document.documentElement.hasAttribute('data-intro-seen')).toBe(true);
    expect(section.hasAttribute('data-intro')).toBe(true);
    for (const { animation } of animations) animation.finish();
    await flush();
    expect(serverH1.firstChild).toBe(serverText);
    expect(serverH1.childNodes).toHaveLength(1);
  });

  it('on a later visit (the sequence seen): the headline is simply there', () => {
    layout();
    sessionStorage.setItem(load.onceKey, '1');
    const { section, container, serverH1, serverText } = page(null);
    hydrate(container);
    expect(section.hasAttribute('data-intro')).toBe(false);
    expect(serverH1.hasAttribute(SET_ATTR)).toBe(true);
    expect(serverH1.firstChild).toBe(serverText);
    expect(animations).toHaveLength(0);
  });

  it('under reduced motion: no sequence starts and the headline is simply there', () => {
    layout();
    window.matchMedia = ((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      addEventListener() {},
      removeEventListener() {},
    })) as unknown as typeof window.matchMedia;
    const { section, container, serverH1, serverText } = page(null);
    hydrate(container);
    expect(section.hasAttribute('data-intro')).toBe(false);
    expect(serverH1.firstChild).toBe(serverText);
    expect(animations).toHaveLength(0);
  });

  it('a client-side visit to the home page in media mode, where no inline script ran: its own beginIntro starts the sequence', () => {
    layout();
    const { section, container, serverH1 } = page(null);
    hydrate(container);
    expect(section.hasAttribute('data-intro')).toBe(true);
    expect(sessionStorage.getItem(load.onceKey)).toBe('1');
    expect(linesOf(serverH1)).toHaveLength(3);
    expect(animations).toHaveLength(3);
  });

  it('past the give-up (a slow script), it does not play: CSS has set the headline in place', () => {
    layout();
    const { container, serverH1, serverText } = page(toMs(load.headline.giveUpAfter) + 50);
    hydrate(container);
    expect(serverH1.hasAttribute(SET_ATTR)).toBe(true);
    expect(serverH1.firstChild).toBe(serverText);
    expect(animations).toHaveLength(0);
  });

  it('turning motion off during the reveal sets it in place at once; with motion off nothing moves', () => {
    layout();
    const { container, serverH1, serverText } = page(100);
    hydrate(container);
    expect(animations).toHaveLength(3);
    state.paused = true;
    const r = root!;
    act(() => r.render(createElement(Headline, { text: TEXT })));
    expect(animations.every(({ animation }) => animation.cancelled)).toBe(true);
    expect(serverH1.firstChild).toBe(serverText);
    expect(serverH1.hasAttribute(SET_ATTR)).toBe(true);
  });

  it('loaded with motion paused, then played from the footer: the sequence does not start in the middle of the visit', () => {
    layout();
    // The head script marks a paused visit before the first paint, so the section's script set nothing.
    document.documentElement.setAttribute('data-motion-paused', 'true');
    state.paused = true;
    const { section, container, serverH1, serverText } = page(null);
    hydrate(container);
    expect(section.hasAttribute('data-intro')).toBe(false);
    expect(serverH1.hasAttribute(SET_ATTR)).toBe(true);
    // "Play motion": lib/motionPause.ts takes the mark off, then tells the hook.
    document.documentElement.removeAttribute('data-motion-paused');
    state.paused = false;
    const r = root!;
    act(() => r.render(createElement(Headline, { text: TEXT })));
    expect(section.hasAttribute('data-intro')).toBe(false);
    expect(section.hasAttribute('data-intro-go')).toBe(false);
    expect(serverH1.firstChild).toBe(serverText);
    expect(serverH1.querySelectorAll(`.${LINE_CLASS}`)).toHaveLength(0);
    expect(animations).toHaveLength(0);
  });

  it('loaded under reduced motion, then reduced motion turned off: nothing replays', () => {
    layout();
    const reduce = { on: true };
    window.matchMedia = ((query: string) => ({
      matches: reduce.on && query === '(prefers-reduced-motion: reduce)',
      media: query,
      addEventListener() {},
      removeEventListener() {},
    })) as unknown as typeof window.matchMedia;
    state.motionOk = false;
    const { section, container, serverH1, serverText } = page(null);
    hydrate(container);
    expect(section.hasAttribute('data-intro')).toBe(false);
    reduce.on = false;
    state.motionOk = true;
    const r = root!;
    act(() => r.render(createElement(Headline, { text: TEXT })));
    expect(section.hasAttribute('data-intro')).toBe(false);
    expect(serverH1.firstChild).toBe(serverText);
    expect(animations).toHaveLength(0);
  });

  it('motion turned off and back on while the sequence still plays: the headline stays set, the reveal does not start again', () => {
    layout();
    const { section, container, serverH1, serverText } = page(100);
    hydrate(container);
    expect(animations).toHaveLength(3);
    const r = root!;
    state.paused = true;
    act(() => r.render(createElement(Headline, { text: TEXT })));
    expect(serverH1.firstChild).toBe(serverText);
    // Media mode keeps the mark until load.end, so the sequence still plays when motion comes back.
    expect(section.hasAttribute('data-intro')).toBe(true);
    state.paused = false;
    act(() => r.render(createElement(Headline, { text: TEXT })));
    expect(animations).toHaveLength(3);
    expect(serverH1.firstChild).toBe(serverText);
    expect(serverH1.hasAttribute(SET_ATTR)).toBe(true);
  });

  it("under StrictMode's doubled effects (development), the reveal still plays", async () => {
    layout();
    const { container, serverH1, serverText } = page(100);
    const { errors, warnings } = hydrate(container, true);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
    // The doubled cleanup cancels the first run's lines; the second run's play.
    expect(animations).toHaveLength(6);
    const live = animations.filter(({ animation }) => !animation.cancelled);
    expect(live).toHaveLength(3);
    expect(linesOf(serverH1)).toEqual(['Hardware engineer', 'for things that', 'move themselves.']);
    for (const { animation } of live) animation.finish();
    await flush();
    expect(serverH1.firstChild).toBe(serverText);
  });

  it('waits for the fonts, so the lines are measured in the face they set in', async () => {
    layout();
    let fontsReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      fontsReady = resolve;
    });
    Object.defineProperty(document, 'fonts', { configurable: true, value: { status: 'loading', ready } });
    try {
      const { container, serverH1 } = page(100);
      hydrate(container);
      // Still in its start state (CSS hides it) until the fonts are in.
      expect(serverH1.hasAttribute(SET_ATTR)).toBe(false);
      expect(animations).toHaveLength(0);
      await act(async () => {
        fontsReady();
        await flush();
      });
      expect(serverH1.hasAttribute(SET_ATTR)).toBe(true);
      expect(animations).toHaveLength(3);
    } finally {
      delete (document as unknown as { fonts?: unknown }).fonts;
    }
  });
});

describe('the start state, the give-up and the lines in CSS (app/motion-drawing.css)', () => {
  const css = fs.readFileSync(path.resolve('app/motion-drawing.css'), 'utf8');
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');

  it('hides the headline only while the sequence plays and no script has taken over, and only with motion', () => {
    const start = bare.indexOf('@media (prefers-reduced-motion: no-preference)', bare.indexOf('hm-headline-set'));
    expect(start).toBeGreaterThan(-1);
    const rule = new RegExp(
      `:root:not\\(\\[data-motion-paused\\]\\) \\.hm-hero\\[data-intro\\] \\.hm-hero__title:not\\(\\[${SET_ATTR}\\]\\) \\{\\s*opacity: 0;\\s*animation: hm-headline-set 0s linear var\\(--hm-headline-giveup, 0s\\) forwards;\\s*\\}`,
    );
    expect(bare.slice(start)).toMatch(rule);
    expect(bare).toMatch(/@keyframes hm-headline-set \{\s*to \{ opacity: 1; \}\s*\}/);
  });

  it('keeps every split line on its one line', () => {
    expect(bare).toContain(`.hm-hero__title .${LINE_CLASS} { white-space: nowrap; }`);
  });

  it('takes the give-up time from lib/motion.ts, through the hero section', async () => {
    const { default: Hero } = await import('../components/home/Hero');
    const { loadPublicProjects, loadSite } = await import('../lib/content');
    const html = renderToString(createElement(Hero, { site: loadSite(), projects: loadPublicProjects() }));
    expect(html).toMatch(new RegExp(`^<section class="hm-hero hm-hero--scrim" aria-labelledby="hero-title" style="--hm-headline-giveup:${toMs(load.headline.giveUpAfter)}ms">`));
    expect(html).toContain(`<h1 class="hm-hero__title" id="hero-title">${TEXT}</h1>`);
  });
});
