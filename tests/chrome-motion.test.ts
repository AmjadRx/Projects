/**
 * The chrome's motion (Phase 5, stage 2; motion sheet 7): the page progress and the lit zone, the
 * heat rule's translations, the panel and menu delays, the numbers app/motion-chrome.css mirrors
 * from lib/motion.ts, the phone menu's Web Animations, the theme cross-fade, and the server render
 * of the new leaves. The panel rise's DOM work is in tests/chrome-rise.test.ts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cssEasing, dur, ease, page, px, toMs } from '../lib/motion';
import { heatTransforms, menuLinkDelay, pageProgress, riseDelay, zoneAt } from '../components/site/chromeMotion';
import { drawOpen, rollUp, unroll, type MenuParts } from '../components/site/menuMotion';
import { THEME_FADE_ATTR, switchTheme } from '../components/site/themeFade';
import HeatRule from '../components/site/HeatRule';
import LitZone from '../components/site/LitZone';
import MobileMenu from '../components/site/MobileMenu';

// Hoisted above the imports by Vitest: the leaves read the path the test sets.
const route = vi.hoisted(() => ({ pathname: '/' as string | null }));
vi.mock('next/navigation', () => ({ usePathname: () => route.pathname }));

/** A file's text with LF line ends, however the checkout wrote them. */
const read = (file: string) => fs.readFileSync(path.resolve(file), 'utf8').replace(/\r\n/g, '\n');

/**
 * The style rules of a piece of CSS, in order, each with its selector, its declarations, and the
 * at-rules it sits in (comments dropped; enough for app/sheet.css, which has no braces in strings).
 */
function cssRules(text: string): { selector: string; body: string; within: string[] }[] {
  const source = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: { selector: string; body: string; within: string[] }[] = [];
  const within: string[] = [];
  let start = 0;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (char === '{') {
      const prelude = source.slice(start, i).trim().replace(/\s+/g, ' ');
      start = i + 1;
      if (prelude.startsWith('@')) {
        within.push(prelude);
        continue;
      }
      const end = source.indexOf('}', i);
      rules.push({ selector: prelude, body: source.slice(i + 1, end).trim(), within: [...within] });
      i = end;
      start = end + 1;
    } else if (char === '}') {
      within.pop();
      start = i + 1;
    } else if (char === ';') {
      start = i + 1;
    }
  }
  return rules;
}

describe('the page progress and the lit zone (sheet 7.1)', () => {
  it('is the distance scrolled over the page height less the window height, held between 0 and 1', () => {
    expect(pageProgress(0, 1000)).toBe(0);
    expect(pageProgress(250, 1000)).toBe(0.25);
    expect(pageProgress(1000, 1000)).toBe(1);
    expect(pageProgress(-40, 1000)).toBe(0);
    expect(pageProgress(1200, 1000)).toBe(1);
  });

  it('is 0 on a page that does not scroll, where Motion would say 1', () => {
    expect(pageProgress(0, 0)).toBe(0);
    expect(pageProgress(0, -5)).toBe(0);
    expect(pageProgress(Number.NaN, 1000)).toBe(0);
  });

  it('lights A for the first sixth of the page and F for the last, the end included', () => {
    const zones = 6;
    expect(zoneAt(0, zones)).toBe(0);
    expect(zoneAt(0.1666, zones)).toBe(0);
    expect(zoneAt(1 / 6, zones)).toBe(1);
    // The board "Raven project page, 1440, scrolled to the roadmap": scroll 0.4, zone C.
    expect(zoneAt(0.4, zones)).toBe(2);
    expect(zoneAt(0.999, zones)).toBe(5);
    expect(zoneAt(1, zones)).toBe(5);
    expect(zoneAt(Number.NaN, zones)).toBe(0);
    expect(zoneAt(0.7, 1)).toBe(0);
  });
});

describe('the heat rule (sheet 7.1, the ramp place 3)', () => {
  it('slides its window in by the progress while the ramp slides back by as much', () => {
    expect(heatTransforms(0)).toEqual({ bar: 'translateX(-100%)', fill: 'translateX(100%)' });
    expect(heatTransforms(0.25)).toEqual({ bar: 'translateX(-75%)', fill: 'translateX(75%)' });
    expect(heatTransforms(1)).toEqual({ bar: 'translateX(0%)', fill: 'translateX(0%)' });
    expect(heatTransforms(2)).toEqual(heatTransforms(1));
    expect(heatTransforms(-1)).toEqual(heatTransforms(0));
    expect(heatTransforms(Number.NaN)).toEqual(heatTransforms(0));
    // The ramp stays on the page width: the two translations always cancel.
    for (const p of [0.1, 1 / 3, 0.5, 0.875]) {
      const { bar, fill } = heatTransforms(p);
      const n = (s: string) => Number(/translateX\((-?[\d.]+)%\)/.exec(s)?.[1]);
      expect(n(bar) + n(fill)).toBeCloseTo(0, 9);
      expect(100 + n(bar)).toBeCloseTo(p * 100, 3);
    }
  });

  it('is tied to scroll in CSS with the same two translations, linear, from the top to the end of the page', () => {
    const css = read('app/motion-chrome.css');
    const frames = (name: string) => {
      const block = new RegExp(`@keyframes ${name} \\{([\\s\\S]*?)\\n\\}`).exec(css)?.[1] ?? '';
      return [...block.matchAll(/transform:\s*([^;]+);/g)].map((m) => m[1].trim());
    };
    expect(frames('ar-heat-bar')).toEqual([heatTransforms(0).bar, heatTransforms(1).bar]);
    expect(frames('ar-heat-fill')).toEqual([heatTransforms(0).fill, heatTransforms(1).fill]);
    expect(page.heatRule.ease).toBe(ease.linear);
    expect(cssEasing(page.heatRule.ease)).toBe('linear');
    expect(css).toMatch(/\.ar-heat__bar \{ animation: ar-heat-bar auto linear both; animation-timeline: scroll\(root block\); \}/);
    expect(css).toMatch(/@supports \(animation-timeline: scroll\(\)\)/);
    // Under reduced motion it is not drawn (sheet 8.1).
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.ar-heat \{ display: none; \} \}/);
    // Nor while the visitor has paused motion (D-67), from the first paint.
    expect(css).toMatch(/^\[data-motion-paused\] \.ar-heat \{ display: none; \}$/m);
  });

  it('holds the dawn at its top-of-page strength while motion is paused, as under reduced motion', () => {
    const sheet = read('app/sheet.css');
    const supports = /@supports \(animation-timeline: scroll\(\)\) \{\n([^\n]*ar-sky-dawn[^\n]*)\n\}/.exec(sheet)?.[1] ?? '';
    // The scroll-tied animation runs only without the pause mark; the base rule holds the minimum.
    expect(supports.trim()).toBe(
      ':root:not([data-motion-paused]) .ar-sky__dawn { animation: ar-sky-dawn auto linear both; animation-timeline: scroll(root block); }',
    );
    expect(sheet).toMatch(/\.ar-sky__dawn \{[^}]*opacity: var\(--sky-dawn-min\);\n\}/);
  });

  it('is as tall as page.heatRule.height (the --heat-rule-height token)', () => {
    const token = /--heat-rule-height:\s*(\d+)px;/.exec(read('app/tokens.css'));
    expect(Number(token?.[1])).toBe(page.heatRule.height);
  });
});

describe('the delays of sheet 7.2 and 7.5', () => {
  it('starts panels that come into view together 60 ms apart, at most three to a group', () => {
    expect([0, 1, 2, 3, 4, 9].map(riseDelay)).toEqual([0, 60, 120, 120, 120, 120]);
    expect(riseDelay(-1)).toBe(0);
    expect(page.panels).toMatchObject({ rise: px.panelRise, duration: dur.base, startAt: 0.85, groupMax: 3 });
  });

  it('sets the menu links 40 ms apart from 80 ms', () => {
    expect([0, 1, 2, 3, 4].map(menuLinkDelay)).toEqual([80, 120, 160, 200, 240]);
  });
});

describe('the numbers app/motion-chrome.css mirrors from lib/motion.ts', () => {
  const css = read('app/motion-chrome.css');
  const root = /:root \{([\s\S]*?)\}/.exec(css)?.[1] ?? '';
  const vars = new Map([...root.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
  const pair = (motion: { duration: number; ease: readonly [number, number, number, number] }) =>
    `${toMs(motion.duration)}ms ${cssEasing(motion.ease)}`;

  it('writes each transition of `page` as its duration and easing', () => {
    expect(vars.get('--page-underline')).toBe(pair(page.underline));
    expect(vars.get('--page-press')).toBe(pair(page.button.press));
    expect(vars.get('--page-fill')).toBe(pair(page.button.hover));
    expect(vars.get('--page-sweep')).toBe(pair(page.button.sweep));
    expect(vars.get('--page-nudge')).toBe(pair(page.nudge));
    expect(vars.get('--page-readout-fill')).toBe(pair(page.readoutFill));
    expect(vars.get('--page-theme-duration')).toBe(`${toMs(page.theme.duration)}ms`);
    expect(vars.get('--page-theme-easing')).toBe(cssEasing(page.theme.ease));
  });

  it('writes the distances of `page`', () => {
    expect(vars.get('--page-press-distance')).toBe(`${page.button.press.distance}px`);
    expect(vars.get('--page-nudge-distance')).toBe(`${page.nudge.distance}px`);
    expect(vars.get('--page-panel-rise')).toBe(`${page.panels.rise}px`);
  });

  it('holds the values of the sheet: 150, 120, 240 and 300 ms, 1, 3 and 16 px', () => {
    expect(vars.get('--page-underline')).toBe('150ms cubic-bezier(0, 0, 0.58, 1)');
    expect(vars.get('--page-press')).toBe('120ms cubic-bezier(0.2, 0.7, 0.2, 1)');
    expect(vars.get('--page-sweep')).toBe('240ms cubic-bezier(0.2, 0.7, 0.2, 1)');
    expect(vars.get('--page-theme-duration')).toBe('300ms');
    expect([vars.get('--page-press-distance'), vars.get('--page-nudge-distance'), vars.get('--page-panel-rise')]).toEqual(['1px', '3px', '16px']);
  });

  it('is what the link and button rules of app/sheet.css read, with no number of their own', () => {
    const sheet = read('app/sheet.css');
    const rule = (selector: string) => {
      const at = sheet.indexOf(`${selector} {`);
      expect(at, selector).toBeGreaterThanOrEqual(0);
      return sheet.slice(at, sheet.indexOf('}', at));
    };
    const uses: [string, string][] = [
      ['.ar-btn', 'transition: transform var(--page-press)'],
      ['.ar-btn::before', 'transition: opacity var(--page-fill)'],
      ['.ar-btn:active', 'translateY(var(--page-press-distance))'],
      ['.ar-btn__sweep', 'transition: transform var(--page-sweep)'],
      ['.ar-btn--text .ar-btn__label::after', 'transition: transform var(--page-underline)'],
      ['.ar-btn--text .ar-icon', 'transition: transform var(--page-nudge)'],
      ['.ar-btn--text:hover .ar-icon', 'translateX(var(--page-nudge-distance))'],
      ['.ar-iconbtn', 'transition: transform var(--page-press)'],
      ['.ar-iconbtn::before', 'transition: opacity var(--page-fill)'],
      ['.ar-iconbtn:active', 'translateY(var(--page-press-distance))'],
      ['.ar-link--standalone .ar-link__text::after', 'transition: transform var(--page-underline)'],
      ['.ar-nav__link::after', 'transition: transform var(--page-underline)'],
      ['.ar-readout::before', 'transition: opacity var(--page-readout-fill)'],
      ['.ar-readout__go', 'transition: transform var(--page-nudge)'],
      ['.ar-readout:hover .ar-readout__go', 'translateX(var(--page-nudge-distance))'],
    ];
    for (const [selector, text] of uses) {
      const body = rule(selector);
      expect(body, selector).toContain(text);
      expect(body, selector).not.toMatch(/\d+ms\b/);
    }
  });

  it('draws the hover states of buttons, links, the theme toggle, the nav, readouts and the pause control for a mouse or a pen only, and the press for every input', () => {
    const sheet = read('app/sheet.css');
    /** The text of section `n` of app/sheet.css, from its heading to the next one. */
    const section = (n: number) => {
      const start = sheet.search(new RegExp(`/\\* -+ ${n}\\. `));
      expect(start, `section ${n}`).toBeGreaterThanOrEqual(0);
      const length = sheet.slice(start + 1).search(/\/\* -+ \d+\. /);
      return sheet.slice(start, start + 1 + length);
    };
    const fine = '@media (hover: hover) and (pointer: fine)';
    const expected: Record<number, string[]> = {
      3: [
        '.ar-btn--primary:hover .ar-btn__sweep',
        '.ar-btn--secondary:hover::before',
        '.ar-btn--text:hover .ar-btn__label::after',
        '.ar-btn--text:hover .ar-icon',
        '.ar-iconbtn:hover::before',
      ],
      4: ['.ar-link--inline:hover', '.ar-link--standalone:hover .ar-link__text::after', '.ar-rev__text a:hover, .ar-callout__text a:hover'],
      7: ['.ar-theme__opt:hover'],
      8: ['.ar-nav__link:hover', '.ar-nav__link:hover::after', '.ar-nav__social:hover'],
      13: ['.ar-readout:hover::before', '.ar-readout:hover .ar-readout__go'],
      // The footer's pause control (components/site/PauseMotion.tsx) sits with the sky's rules.
      23: ['.ar-foot__pause:hover'],
    };
    for (const [n, selectors] of Object.entries(expected)) {
      const rules = cssRules(section(Number(n)));
      const hover = rules.filter((r) => r.selector.includes(':hover'));
      expect(hover.map((r) => r.selector)).toEqual(selectors);
      for (const r of hover) expect(r.within, r.selector).toContain(fine);
      // The press and the transitions answer touch too.
      for (const r of rules.filter((x) => x.selector.includes(':active') || x.body.includes('transition'))) {
        expect(r.within, r.selector).not.toContain(fine);
      }
    }
  });

  it('keeps every arrow put under reduced motion (sheet 7.7 and 8.1)', () => {
    const block = /@media \(prefers-reduced-motion: reduce\) \{\n([\s\S]*?)\n\}/.exec(css.slice(css.indexOf('Links and buttons')))?.[1] ?? '';
    expect(block).toContain('.ar-btn--text:hover .ar-icon');
    expect(block).toContain('.ar-readout:hover .ar-readout__go');
    expect(block).toContain('.ar-card:hover .ar-card__open .ar-icon');
    expect(block).toContain('transform: none');
  });

  it('never hides a waiting panel under reduced motion or in print', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\), print \{\n\s*\.ar-frame \[data-ar-rise\] \{ opacity: 1 !important; translate: none !important; \}/);
  });

  it('lets a waiting panel take no pointer input, only where it is unseen', () => {
    expect(css).toContain('@media (prefers-reduced-motion: no-preference) { .ar-frame [data-ar-rise] { pointer-events: none; } }');
    expect(/\.ar-frame \[data-ar-rise\] \{ opacity: 0;[^}]*\}/.exec(css)?.[0]).not.toContain('pointer-events');
  });

  it('times the theme cross-fade only while the attribute is on <html>', () => {
    for (const part of ['group', 'old', 'new']) {
      expect(css).toContain(`:root[${THEME_FADE_ATTR}]::view-transition-${part}(root)`);
    }
    expect(css).toContain(`:root[${THEME_FADE_ATTR}] .ar-theme--compact { view-transition-name: ar-theme-compact; }`);
    expect(css).toContain(`:root[${THEME_FADE_ATTR}] .ar-theme--full { view-transition-name: ar-theme-full; }`);
  });
});

/** A fake Web Animation that records what was done to it, and its play state. */
function fakeAnimation() {
  let resolve: () => void = () => {};
  const finished = new Promise<void>((r) => {
    resolve = r;
  });
  const animation = {
    playState: 'running' as AnimationPlayState,
    paused: 0,
    played: 0,
    cancelled: 0,
    finished,
    finish() {
      animation.playState = 'finished';
      resolve();
    },
    pause() {
      animation.paused += 1;
      animation.playState = 'paused';
    },
    play() {
      animation.played += 1;
      animation.playState = 'running';
    },
    cancel() {
      animation.cancelled += 1;
      animation.playState = 'idle';
    },
  };
  return animation;
}
type FakeAnimation = ReturnType<typeof fakeAnimation>;

/** A fake element whose `animate` calls are recorded, with a computed transform. */
function fakeElement(transform = 'none') {
  const calls: { keyframes: Keyframe[]; options: KeyframeAnimationOptions; animation: FakeAnimation }[] = [];
  const element = {
    calls,
    transform,
    ownerDocument: { defaultView: { getComputedStyle: (of: { transform: string }) => ({ transform: of.transform }) } },
    animate(keyframes: Keyframe[], options: KeyframeAnimationOptions) {
      const animation = fakeAnimation();
      calls.push({ keyframes, options, animation });
      return animation;
    },
  };
  return element;
}

function fakeMenu(links = 5) {
  const roll = fakeElement();
  const sheet = fakeElement();
  const edge = fakeElement();
  const items = Array.from({ length: links }, () => fakeElement());
  const parts = { roll, sheet, edge, links: items } as unknown as MenuParts;
  return { roll, sheet, edge, items, parts };
}

describe('the phone menu (sheet 7.5)', () => {
  it('unrolls: the roll comes down from above while the sheet counter-moves, in 320 ms (settle)', () => {
    const { roll, sheet, edge, parts } = fakeMenu();
    unroll(parts);
    const timing = { duration: 320, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' };
    expect(roll.calls[0].keyframes).toEqual([{ transform: 'translateY(-100%)' }, { transform: 'none' }]);
    expect(roll.calls[0].options).toEqual(timing);
    expect(sheet.calls[0].keyframes).toEqual([{ transform: 'translateY(100%)' }, { transform: 'none' }]);
    expect(sheet.calls[0].options).toEqual(timing);
    // The 1 px line rides the edge only while it opens.
    expect(edge.calls[0].keyframes).toEqual([{ opacity: 1 }, { opacity: 1 }]);
    expect(edge.calls[0].options).toEqual(timing);
    expect(toMs(page.menu.open.duration)).toBe(320);
  });

  it('sets the links in sequence: an 8 px drop and a fade, 200 ms each, 40 ms apart from 80 ms', () => {
    const { items, parts } = fakeMenu();
    unroll(parts);
    items.forEach((link, index) => {
      expect(link.calls[0].keyframes).toEqual([
        { opacity: 0, transform: 'translateY(-8px)' },
        { opacity: 1, transform: 'none' },
      ]);
      expect(link.calls[0].options).toEqual({ duration: 200, delay: 80 + 40 * index, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)', fill: 'backwards' });
    });
  });

  it('rolls back up from where it is, in 240 ms (exit), the links with it', () => {
    const { roll, sheet, edge, items, parts } = fakeMenu();
    const running = unroll(parts);
    // Halfway down when Close is pressed.
    roll.transform = 'matrix(1, 0, 0, 1, 0, -300)';
    sheet.transform = 'matrix(1, 0, 0, 1, 0, 300)';
    const rolling = rollUp(parts, running);
    const timing = { duration: 240, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' };
    expect(roll.calls[1].keyframes).toEqual([{ transform: 'matrix(1, 0, 0, 1, 0, -300)' }, { transform: 'translateY(-100%)' }]);
    expect(roll.calls[1].options).toEqual(timing);
    expect(sheet.calls[1].keyframes).toEqual([{ transform: 'matrix(1, 0, 0, 1, 0, 300)' }, { transform: 'translateY(100%)' }]);
    expect(sheet.calls[1].options).toEqual(timing);
    expect(rolling.frame).toHaveLength(2);
    expect(rolling.frame[0]).toBe(roll.calls[1].animation);
    expect(rolling.frame[1]).toBe(sheet.calls[1].animation);
    expect(rolling.finished).toBe(roll.calls[1].animation.finished);
    expect(rolling.links).toBe(running.links);
    // The unroll's own animations stop: the frame's are dropped, the links stop where they are.
    expect(running.frame.map((a) => (a as unknown as FakeAnimation).cancelled)).toEqual([1, 1, 1]);
    expect(items.map((link) => link.calls[0].animation.paused)).toEqual([1, 1, 1, 1, 1]);
    // No line on the way up, and no new animation on the links.
    expect(edge.calls).toHaveLength(1);
    expect(items.every((link) => link.calls.length === 1)).toBe(true);
  });

  it('rolls up from rest when nothing is running', () => {
    const { roll, sheet, parts } = fakeMenu(0);
    rollUp(parts, null);
    expect(roll.calls[0].keyframes[0]).toEqual({ transform: 'none' });
    expect(sheet.calls[0].keyframes[0]).toEqual({ transform: 'none' });
    expect(toMs(page.menu.close.duration)).toBe(240);
    expect(page.menu.close.ease).toBe(ease.exit);
  });

  it('leaves a link that has set as it is on the way up', () => {
    const { items, parts } = fakeMenu(3);
    const running = unroll(parts);
    items[0].calls[0].animation.finish();
    rollUp(parts, running);
    expect(items.map((link) => link.calls[0].animation.paused)).toEqual([0, 1, 1]);
    expect(items[0].calls[0].animation.playState).toBe('finished');
  });

  it('comes back down from where the roll-up has got to when Menu is pressed again, the links carrying on', () => {
    const { roll, sheet, edge, items, parts } = fakeMenu(3);
    const running = unroll(parts);
    // The first link had set when Close was pressed; the other two were still setting.
    items[0].calls[0].animation.finish();
    const rolling = rollUp(parts, running);
    // A third of the way up when Menu is pressed.
    roll.transform = 'matrix(1, 0, 0, 1, 0, -200)';
    sheet.transform = 'matrix(1, 0, 0, 1, 0, 200)';
    const again = unroll(parts, rolling);
    const timing = { duration: 320, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' };
    expect(roll.calls[2].keyframes).toEqual([{ transform: 'matrix(1, 0, 0, 1, 0, -200)' }, { transform: 'none' }]);
    expect(roll.calls[2].options).toEqual(timing);
    expect(sheet.calls[2].keyframes).toEqual([{ transform: 'matrix(1, 0, 0, 1, 0, 200)' }, { transform: 'none' }]);
    expect(sheet.calls[2].options).toEqual(timing);
    // The roll-up stops, and the line rides the edge again.
    expect(rolling.frame.map((a) => (a as unknown as FakeAnimation).cancelled)).toEqual([1, 1]);
    expect(edge.calls).toHaveLength(2);
    expect(edge.calls[1].keyframes).toEqual([{ opacity: 1 }, { opacity: 1 }]);
    // The links stopped on the way up carry on, the one that had set stays set, and none starts over.
    expect(items.map((link) => link.calls[0].animation.played)).toEqual([0, 1, 1]);
    expect(items.map((link) => link.calls[0].animation.playState)).toEqual(['finished', 'running', 'running']);
    expect(items.every((link) => link.calls.length === 1)).toBe(true);
    expect(again.links).toBe(running.links);
    expect(again.frame[0]).toBe(roll.calls[2].animation);
    expect(again.frame[1]).toBe(sheet.calls[2].animation);
    expect(again.frame[2]).toBe(edge.calls[1].animation);
  });

  it('draws the menu open at once, the roll-up and the links stopped, when it may no longer move', () => {
    const { items, parts } = fakeMenu(2);
    const rolling = rollUp(parts, unroll(parts));
    drawOpen(rolling);
    expect(rolling.frame.map((a) => (a as unknown as FakeAnimation).cancelled)).toEqual([1, 1]);
    expect(items.map((link) => link.calls[0].animation.cancelled)).toEqual([1, 1]);
  });
});

describe('the theme cross-fade (sheet 7.6)', () => {
  /**
   * The reduced-motion query. lib/useMotionOk.ts keeps the first query it is given for the rest of
   * the page, so every fake browser hands out this one object and sets its answer.
   */
  const reducedQuery = { matches: false, addEventListener() {}, removeEventListener() {} };

  /** A browser with <html>, the cookie, the reduced-motion setting and, if asked, View Transitions. */
  function fakeBrowser({ reduced = false, transitions = true, throws = false } = {}) {
    const attrs = new Map<string, string>([['data-theme', 'blueprint']]);
    const seen: string[] = [];
    const cookies: string[] = [];
    const pending: { update: () => void; finish: () => void }[] = [];
    const documentElement = {
      getAttribute: (name: string) => attrs.get(name) ?? null,
      setAttribute: (name: string, value: string) => void attrs.set(name, value),
      removeAttribute: (name: string) => void attrs.delete(name),
      hasAttribute: (name: string) => attrs.has(name),
    };
    const doc: Record<string, unknown> = {
      documentElement,
      set cookie(value: string) {
        cookies.push(value);
      },
    };
    if (transitions) {
      doc.startViewTransition = (update: () => void) => {
        if (throws) throw new Error('not now');
        seen.push(`start fade=${attrs.has(THEME_FADE_ATTR)} theme=${attrs.get('data-theme')}`);
        let finish: () => void = () => {};
        const finished = new Promise<void>((resolve) => {
          finish = resolve;
        });
        pending.push({ update, finish });
        return { ready: Promise.resolve(), updateCallbackDone: Promise.resolve(), finished };
      };
    }
    reducedQuery.matches = reduced;
    vi.stubGlobal('document', doc);
    vi.stubGlobal('window', { location: { pathname: '/' }, matchMedia: () => reducedQuery });
    return { attrs, seen, cookies, pending };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('cross-fades through startViewTransition, with the attribute on <html> for the fade only', async () => {
    const { attrs, seen, cookies, pending } = fakeBrowser();
    switchTheme('whiteprint');
    expect(seen).toEqual(['start fade=true theme=blueprint']);
    // The browser has the old picture; then it runs the update, which changes the theme.
    pending[0].update();
    expect(attrs.get('data-theme')).toBe('whiteprint');
    expect(cookies[0]).toMatch(/^theme=whiteprint; Path=\/; Max-Age=\d+; SameSite=Lax$/);
    expect(attrs.has(THEME_FADE_ATTR)).toBe(true);
    pending[0].finish();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(attrs.has(THEME_FADE_ATTR)).toBe(false);
  });

  it('keeps the attribute until the last of two quick fades ends', async () => {
    const { attrs, pending } = fakeBrowser();
    switchTheme('whiteprint');
    pending[0].update();
    switchTheme('blueprint');
    pending[0].finish();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(attrs.has(THEME_FADE_ATTR)).toBe(true);
    pending[1].update();
    pending[1].finish();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(attrs.has(THEME_FADE_ATTR)).toBe(false);
    expect(attrs.get('data-theme')).toBe('blueprint');
  });

  it('changes the theme at once under reduced motion', () => {
    const { attrs, seen } = fakeBrowser({ reduced: true });
    switchTheme('whiteprint');
    expect(seen).toEqual([]);
    expect(attrs.get('data-theme')).toBe('whiteprint');
    expect(attrs.has(THEME_FADE_ATTR)).toBe(false);
  });

  it('changes the theme at once where the browser has no View Transitions, or refuses one', () => {
    const plain = fakeBrowser({ transitions: false });
    switchTheme('whiteprint');
    expect(plain.attrs.get('data-theme')).toBe('whiteprint');
    expect(plain.attrs.has(THEME_FADE_ATTR)).toBe(false);
    vi.unstubAllGlobals();
    const refused = fakeBrowser({ throws: true });
    switchTheme('whiteprint');
    expect(refused.attrs.get('data-theme')).toBe('whiteprint');
    expect(refused.attrs.has(THEME_FADE_ATTR)).toBe(false);
  });

  it('only refreshes the choice when the theme is already shown', () => {
    const { attrs, seen, cookies } = fakeBrowser();
    switchTheme('blueprint');
    expect(seen).toEqual([]);
    expect(attrs.get('data-theme')).toBe('blueprint');
    expect(cookies).toHaveLength(1);
  });
});

describe('the server render of the new leaves', () => {
  afterEach(() => {
    route.pathname = '/';
  });

  it('draws the heat rule, decorative and not hidden, in its start state', () => {
    const html = renderToString(createElement(HeatRule));
    expect(html).toBe('<div class="ar-heat" aria-hidden="true"><div class="ar-heat__bar"><div class="ar-heat__fill"></div></div></div>');
  });

  it('lights zone A, the top of the page, and only A', () => {
    const html = renderToString(createElement(LitZone, { marks: ['A', 'B', 'C', 'D', 'E', 'F'] }));
    expect(html).toBe(
      '<ol class="ar-sheetframe__rows"><li class="is-lit">A</li><li>B</li><li>C</li><li>D</li><li>E</li><li>F</li></ol>',
    );
  });

  it('renders the closed menu as its button alone', () => {
    const html = renderToString(
      createElement(MobileMenu, {
        name: 'Name',
        items: [{ label: 'Projects', href: '/projects' }],
        socials: [],
        labels: {
          menu: 'Menu',
          close: 'Close',
          nav: 'Primary',
          theme: { group: 'Theme', blueprint: 'Blueprint', whiteprint: 'Whiteprint', blueprintTheme: 'B', whiteprintTheme: 'W' },
        },
        initialTheme: 'blueprint',
      }),
    );
    expect(html).toContain('class="ar-menubtn"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('ar-mmenu');
    expect(html).not.toContain('aria-controls');
  });
});
