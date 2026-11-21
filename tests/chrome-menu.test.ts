// @vitest-environment jsdom
/**
 * The phone menu's phases (components/site/MobileMenu.tsx; motion sheet 7.5), rendered in a DOM
 * with the Web Animations faked so each one can be finished by hand: closed, open (unrolling, focus
 * on Close, focus trapped, the page held), closing (rolling up, focus back on Menu, the page free,
 * the sheet inert) and closed again; Menu pressed while it rolls up; a route change; a frame that
 * reaches 1024 px; and reduced motion, where it opens and closes at once. The keyframes themselves
 * are tested in tests/chrome-motion.test.ts.
 */
import { act, createElement as h, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { page, toMs } from '../lib/motion';
import MobileMenu from '../components/site/MobileMenu';

// Hoisted above the imports by Vitest: the menu reads the path the test sets.
const route = vi.hoisted(() => ({ pathname: '/' }));
vi.mock('next/navigation', () => ({ usePathname: () => route.pathname }));
// The links are plain anchors here: no router runs in the test.
vi.mock('next/link', async () => {
  const { createElement } = await import('react');
  return {
    default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement('a', { href, ...rest }, children),
  };
});

/** The reduced-motion query that lib/useMotionOk.ts keeps for the page; the tests set its answer. */
const reduced = { matches: false, addEventListener() {}, removeEventListener() {} };

interface FakeAnimation {
  target: Element;
  keyframes: Keyframe[];
  options: KeyframeAnimationOptions;
  playState: AnimationPlayState;
  finished: Promise<FakeAnimation>;
  finish(): void;
  cancel(): void;
  pause(): void;
  play(): void;
}

/** Every animation started, in order. */
const made: FakeAnimation[] = [];

function animate(this: HTMLElement, keyframes: Keyframe[] | PropertyIndexedKeyframes | null, options?: number | KeyframeAnimationOptions) {
  let settle = { resolve: (_value: FakeAnimation) => {}, reject: (_reason: unknown) => {} };
  const finished = new Promise<FakeAnimation>((resolve, reject) => {
    settle = { resolve, reject };
  });
  finished.catch(() => {});
  const animation: FakeAnimation = {
    target: this,
    keyframes: keyframes as Keyframe[],
    options: options as KeyframeAnimationOptions,
    playState: 'running',
    finished,
    finish() {
      animation.playState = 'finished';
      settle.resolve(animation);
    },
    cancel() {
      animation.playState = 'idle';
      settle.reject(new Error('cancelled'));
    },
    pause() {
      animation.playState = 'paused';
    },
    play() {
      animation.playState = 'running';
    },
  };
  made.push(animation);
  return animation as unknown as Animation;
}

/** The animations started on the menu part with this class, in order. */
const on = (className: string) => made.filter((animation) => animation.target.classList.contains(className));
const last = (className: string) => on(className).at(-1)!;

const LABELS = {
  menu: 'Menu',
  close: 'Close',
  nav: 'Primary',
  theme: { group: 'Theme', blueprint: 'Blueprint', whiteprint: 'Whiteprint', blueprintTheme: 'Blueprint theme', whiteprintTheme: 'Whiteprint theme' },
};
const ITEMS = [
  { label: 'Projects', href: '/projects' },
  { label: 'About', href: '/about' },
  { label: 'Contact', href: '/contact' },
];

let root: Root | null = null;
let frame: HTMLElement;
let frameWidth = 390;

const menu = () => h(MobileMenu, { name: 'Name', items: ITEMS, socials: [], labels: LABELS, initialTheme: 'blueprint' as const });
const menuButton = () => frame.querySelector<HTMLButtonElement>('.ar-menubtn')!;
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const closeButton = () => dialog()!.querySelector<HTMLButtonElement>('.ar-menubtn')!;
const press = (key: string) => document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));

async function open() {
  await act(async () => menuButton().click());
}

/** Escape, then the roll-up's animations: the roll's and the sheet's. */
async function escape() {
  await act(async () => press('Escape'));
  return { roll: last('ar-mmenu__roll'), sheet: last('ar-mmenu__sheet') };
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = (() => reduced) as unknown as typeof window.matchMedia;
});

beforeEach(async () => {
  made.length = 0;
  frameWidth = 390;
  HTMLElement.prototype.animate = animate as unknown as typeof HTMLElement.prototype.animate;
  // The page frame, whose width says whether the inline nav shows (the menu checks it).
  frame = document.createElement('div');
  frame.className = 'ar-frame';
  frame.getBoundingClientRect = () => ({ width: frameWidth, height: 800, top: 0, left: 0, right: frameWidth, bottom: 800, x: 0, y: 0, toJSON() {} }) as DOMRect;
  document.body.appendChild(frame);
  root = createRoot(frame);
  await act(async () => root!.render(menu()));
});

afterEach(async () => {
  await act(async () => root!.unmount());
  root = null;
  document.body.replaceChildren();
  document.documentElement.style.overflow = '';
  route.pathname = '/';
  reduced.matches = false;
  delete (HTMLElement.prototype as { animate?: unknown }).animate;
});

describe('the phone menu, opening', () => {
  it('draws only the Menu button while closed', () => {
    expect(dialog()).toBeNull();
    expect(menuButton().getAttribute('aria-expanded')).toBe('false');
  });

  it('opens on Menu: the sheet unrolls from the top, focus goes to Close, and the page is held', async () => {
    await open();
    expect(dialog()?.getAttribute('data-phase')).toBe('open');
    expect(menuButton().getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(closeButton());
    expect(document.documentElement.style.overflow).toBe('hidden');
    expect(on('ar-mmenu__roll')[0].keyframes).toEqual([{ transform: 'translateY(-100%)' }, { transform: 'none' }]);
    expect(on('ar-mmenu__roll')[0].options).toMatchObject({ duration: toMs(page.menu.open.duration) });
    expect(on('ar-mmenu__link')).toHaveLength(ITEMS.length);
  });

  it('keeps Tab inside the open menu', async () => {
    // The shared trap skips what is not drawn; jsdom draws nothing, so every control counts as drawn.
    const rects = vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue({ length: 1 } as DOMRectList);
    await open();
    const controls = Array.from(dialog()!.querySelectorAll<HTMLElement>('a[href], button'));
    controls.at(-1)!.focus();
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    });
    expect(document.activeElement).toBe(controls[0]);
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    });
    expect(document.activeElement).toBe(controls.at(-1));
    rects.mockRestore();
  });
});

describe('the phone menu, closing', () => {
  it('rolls up on Escape with focus back on Menu, the page free and the sheet inert, then closes when the roll is up', async () => {
    await open();
    const { roll, sheet } = await escape();

    expect(dialog()?.getAttribute('data-phase')).toBe('closing');
    expect(dialog()?.hasAttribute('inert')).toBe(true);
    expect(document.activeElement).toBe(menuButton());
    expect(menuButton().getAttribute('aria-expanded')).toBe('false');
    expect(document.documentElement.style.overflow).toBe('');
    expect(roll.keyframes.at(-1)).toEqual({ transform: 'translateY(-100%)' });
    expect(sheet.keyframes.at(-1)).toEqual({ transform: 'translateY(100%)' });
    expect(roll.options).toMatchObject({ duration: toMs(page.menu.close.duration), fill: 'forwards' });

    await act(async () => roll.finish());
    expect(dialog()).toBeNull();
  });

  it('rolls up on Close the same way', async () => {
    await open();
    await act(async () => closeButton().click());
    expect(dialog()?.getAttribute('data-phase')).toBe('closing');
    expect(document.activeElement).toBe(menuButton());
    await act(async () => last('ar-mmenu__roll').finish());
    expect(dialog()).toBeNull();
  });

  it('comes back down from where it is when Menu is pressed during the roll-up', async () => {
    await open();
    const links = on('ar-mmenu__link');
    const { roll, sheet } = await escape();
    expect(links.every((animation) => animation.playState === 'paused')).toBe(true);
    // Partway up when Menu is pressed (the roll-up's current frame, as the browser computes it).
    const rollPart = dialog()!.querySelector<HTMLElement>('.ar-mmenu__roll')!;
    const sheetPart = dialog()!.querySelector<HTMLElement>('.ar-mmenu__sheet')!;
    rollPart.style.transform = 'matrix(1, 0, 0, 1, 0, -120)';
    sheetPart.style.transform = 'matrix(1, 0, 0, 1, 0, 120)';

    await open();

    expect(dialog()?.getAttribute('data-phase')).toBe('open');
    expect(dialog()?.hasAttribute('inert')).toBe(false);
    expect(menuButton().getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(closeButton());
    expect(document.documentElement.style.overflow).toBe('hidden');
    expect([roll.playState, sheet.playState]).toEqual(['idle', 'idle']);
    expect(last('ar-mmenu__roll').keyframes).toEqual([{ transform: 'matrix(1, 0, 0, 1, 0, -120)' }, { transform: 'none' }]);
    expect(last('ar-mmenu__sheet').keyframes).toEqual([{ transform: 'matrix(1, 0, 0, 1, 0, 120)' }, { transform: 'none' }]);
    // The links carry on setting; none starts over.
    expect(links.every((animation) => animation.playState === 'running')).toBe(true);
    expect(on('ar-mmenu__link')).toHaveLength(ITEMS.length);

    // The roll-up it stopped never closes the menu, and the next Escape rolls it up as usual.
    await act(async () => {
      await Promise.resolve();
    });
    expect(dialog()?.getAttribute('data-phase')).toBe('open');
    const again = await escape();
    expect(dialog()?.getAttribute('data-phase')).toBe('closing');
    await act(async () => again.roll.finish());
    expect(dialog()).toBeNull();
  });

  it('comes back down from where the roll-up left it when Menu is pressed after the roll-up ends but before the closed menu is drawn', async () => {
    await open();
    const { roll, sheet } = await escape();
    // The sheet is up, held there by the roll-up's last frame.
    dialog()!.querySelector<HTMLElement>('.ar-mmenu__roll')!.style.transform = 'matrix(1, 0, 0, 1, 0, -800)';
    dialog()!.querySelector<HTMLElement>('.ar-mmenu__sheet')!.style.transform = 'matrix(1, 0, 0, 1, 0, 800)';

    await act(async () => {
      roll.finish();
      sheet.finish();
      // The roll-up's end asks for the closed phase (a microtask); Menu is pressed before React
      // draws it, so the same sheet is drawn open again without ever being removed.
      await Promise.resolve();
      menuButton().click();
    });

    expect(dialog()?.getAttribute('data-phase')).toBe('open');
    expect(document.activeElement).toBe(closeButton());
    // The roll-up's held last frames are dropped, so the sheet stays down once it lands...
    expect([roll.playState, sheet.playState]).toEqual(['idle', 'idle']);
    // ...and it comes down from where the roll-up left it, with no jump.
    expect(last('ar-mmenu__roll').keyframes).toEqual([{ transform: 'matrix(1, 0, 0, 1, 0, -800)' }, { transform: 'none' }]);
    expect(last('ar-mmenu__sheet').keyframes).toEqual([{ transform: 'matrix(1, 0, 0, 1, 0, 800)' }, { transform: 'none' }]);
  });

  it('opens anew from the top after it has closed', async () => {
    await open();
    const { roll } = await escape();
    await act(async () => roll.finish());
    await open();
    expect(last('ar-mmenu__roll').keyframes[0]).toEqual({ transform: 'translateY(-100%)' });
    expect(on('ar-mmenu__link')).toHaveLength(ITEMS.length * 2);
  });

  it('closes on a route change, leaving focus to the new page', async () => {
    await open();
    route.pathname = '/about';
    await act(async () => root!.render(menu()));
    expect(dialog()?.getAttribute('data-phase')).toBe('closing');
    expect(document.activeElement).not.toBe(menuButton());
    expect(document.documentElement.style.overflow).toBe('');
    await act(async () => last('ar-mmenu__roll').finish());
    expect(dialog()).toBeNull();
    expect(document.activeElement).not.toBe(menuButton());
  });

  it('closes at once when the page frame reaches 1024 px', async () => {
    await open();
    frameWidth = 1200;
    await act(async () => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(dialog()).toBeNull();
    expect(document.documentElement.style.overflow).toBe('');
  });
});

describe('the phone menu under reduced motion', () => {
  it('opens and closes at once, with nothing animated', async () => {
    reduced.matches = true;
    await open();
    expect(dialog()?.getAttribute('data-phase')).toBe('open');
    expect(document.activeElement).toBe(closeButton());
    await act(async () => press('Escape'));
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(menuButton());
    expect(made).toHaveLength(0);
  });
});
