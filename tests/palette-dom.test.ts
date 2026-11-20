// @vitest-environment jsdom
/**
 * The command palette in a document (components/palette/PaletteTrigger.tsx and CommandPalette.tsx):
 * the nav's button and the shortcut open it on demand, and a request still loading can be called
 * off; focus goes to the field and stays inside (Tab included, from wherever focus has fallen)
 * while it is open; the arrow keys move the active result (aria-activedescendant, aria-selected);
 * Enter follows the active result's link; Escape, Close, the scrim, and the shortcut again close it
 * and return focus to what opened it; the chosen page's main, or the chosen section, takes focus
 * once its page shows it; the count, or what to try, is read politely; the page behind is held
 * still; and the shortcut does nothing in a field or over another layer.
 */
import { act, createElement as h, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import PaletteTrigger from '../components/palette/PaletteTrigger';
import { resetPaletteLoad } from '../components/palette/load';
import type { PaletteIndex } from '../lib/palette';

// Hoisted above the imports by Vitest: the route the components read, and where links went.
const route = vi.hoisted(() => ({ pathname: '/', followed: [] as string[] }));
vi.mock('next/navigation', () => ({ usePathname: () => route.pathname }));
// A link here is a plain anchor; following one records it instead of navigating (no router runs).
vi.mock('next/link', async () => {
  const { createElement } = await import('react');
  return {
    default: ({ href, children, prefetch: _prefetch, onClick, ...rest }: { href: string; children: ReactNode; prefetch?: boolean; onClick?: (e: MouseEvent) => void }) =>
      createElement(
        'a',
        {
          href,
          ...rest,
          onClick: (event: MouseEvent) => {
            onClick?.(event);
            if (!event.defaultPrevented) route.followed.push(href);
            event.preventDefault();
          },
        },
        children,
      ),
  };
});

const INDEX: PaletteIndex = {
  groups: [
    {
      label: 'Pages',
      items: [
        { label: 'Home', meta: 'Page', href: '/' },
        { label: 'Projects', meta: 'Page', href: '/projects' },
        { label: 'Build log', meta: 'Page', href: '/log' },
      ],
    },
    { label: 'Projects', items: [{ label: 'Raven', meta: 'Sheet 2 of 12', href: '/projects/raven' }] },
    {
      label: 'Sections',
      items: [
        { label: 'Raven: Roadmap', meta: 'Section', href: '/projects/raven#rv-e' },
        { label: 'Raven: Build photos', meta: 'Section', href: '/projects/raven#rv-h' },
      ],
    },
  ],
  pages: ['Projects', 'Build log'],
};

let root: Root | null = null;
let frame: HTMLElement;
let fetchCalls = 0;

const trigger = () =>
  h(PaletteTrigger, { label: 'Search pages and projects', children: h('span', { className: 'ar-nav__search-text' }, 'Search') });
const button = () => frame.querySelector<HTMLButtonElement>('.ar-nav__search')!;
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const input = () => document.querySelector<HTMLInputElement>('.ar-cmdk__input')!;
const options = () => Array.from(document.querySelectorAll<HTMLAnchorElement>('[role="option"]'));
const activeOption = () => document.querySelector<HTMLAnchorElement>('[role="option"][aria-selected="true"]');
const main = () => document.getElementById('main')!;

/** The page shows another route, as the router does after a link (the nav stays mounted). */
async function showRoute(pathname: string) {
  route.pathname = pathname;
  await act(async () => root!.render(trigger()));
}

/** Holds the index's fetch until the returned function lets it through. */
function holdIndex(): () => Promise<void> {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      fetchCalls += 1;
      await gate;
      return new Response(JSON.stringify(INDEX), { status: 200 });
    }),
  );
  return async () => {
    release();
    await settle();
  };
}

/** Lets the dynamic import and the fetch settle, then React render. */
async function settle() {
  for (let i = 0; i < 5; i += 1) await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}

function key(target: EventTarget, init: KeyboardEventInit) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

/** Types into the field as React hears it. */
function type(text: string) {
  const field = input();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(field, text);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function openByButton() {
  await act(async () => button().click());
  await settle();
}

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(async () => {
  route.pathname = '/';
  route.followed.length = 0;
  fetchCalls = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      fetchCalls += 1;
      return new Response(JSON.stringify(INDEX), { status: 200, headers: { 'content-type': 'application/json' } });
    }),
  );
  // The page frame the palette is drawn in, as on the site (components/site/SiteChrome.tsx), with
  // its main, the skip link's target.
  frame = document.createElement('div');
  frame.className = 'ar-frame';
  const header = document.createElement('header');
  const mount = document.createElement('div');
  const page = document.createElement('main');
  page.id = 'main';
  page.tabIndex = -1;
  page.innerHTML = '<a id="before" href="/about">About</a><h2 id="rv-e">Roadmap</h2><h2 id="rv-h">Build photos</h2><input id="field">';
  header.appendChild(mount);
  frame.append(header, page);
  document.body.appendChild(frame);
  root = createRoot(mount);
  await act(async () => root!.render(trigger()));
});

afterEach(async () => {
  await act(async () => root!.unmount());
  root = null;
  document.body.replaceChildren();
  document.documentElement.style.overflow = '';
  vi.unstubAllGlobals();
  vi.useRealTimers();
  resetPaletteLoad();
});

describe('the button', () => {
  it('is drawn closed, names its shortcut and its dialog, and loads nothing yet', () => {
    expect(dialog()).toBeNull();
    expect(button().getAttribute('aria-label')).toBe('Search pages and projects');
    expect(button().getAttribute('aria-keyshortcuts')).toBe('Control+K Meta+K');
    expect(button().getAttribute('aria-haspopup')).toBe('dialog');
    expect(button().getAttribute('aria-expanded')).toBe('false');
    expect(button().hasAttribute('aria-controls')).toBe(false);
    expect(fetchCalls).toBe(0);
  });

  it('fetches the palette ahead on hover or focus', async () => {
    await act(async () => button().dispatchEvent(new Event('pointerover', { bubbles: true })));
    await act(async () => button().focus());
    await settle();
    expect(fetchCalls).toBe(1);
  });

  it('opens the palette in the page frame, with focus in the field and the page held still', async () => {
    await openByButton();
    expect(dialog()).not.toBeNull();
    expect(dialog()!.getAttribute('aria-modal')).toBe('true');
    expect(dialog()!.getAttribute('aria-label')).toBe('Search pages, projects and sections');
    expect(dialog()!.closest('.ar-frame')).toBe(frame);
    expect(button().getAttribute('aria-expanded')).toBe('true');
    expect(button().getAttribute('aria-controls')).toBe(dialog()!.id);
    expect(document.activeElement).toBe(input());
    expect(document.documentElement.style.overflow).toBe('hidden');
  });
});

describe('the combobox', () => {
  it('lists every result in its groups, with the first active', async () => {
    await openByButton();
    const field = input();
    expect(field.getAttribute('role')).toBe('combobox');
    expect(field.getAttribute('aria-expanded')).toBe('true');
    expect(field.getAttribute('aria-autocomplete')).toBe('list');
    const list = document.getElementById(field.getAttribute('aria-controls')!)!;
    expect(list.getAttribute('role')).toBe('listbox');
    expect(Array.from(list.querySelectorAll('[role="group"]')).map((g) => g.getAttribute('aria-label'))).toEqual(['Pages', 'Projects', 'Sections']);
    expect(options().map((o) => o.textContent)).toEqual([
      'HomePage',
      'ProjectsPage',
      'Build logPage',
      'RavenSheet 2 of 12',
      'Raven: RoadmapSection',
      'Raven: Build photosSection',
    ]);
    expect(options().every((o) => o.tabIndex === -1)).toBe(true);
    expect(field.getAttribute('aria-activedescendant')).toBe(options()[0].id);
    expect(activeOption()).toBe(options()[0]);
  });

  it('filters as the visitor types, marks the match, and makes the first result active', async () => {
    await openByButton();
    key(input(), { key: 'ArrowDown' });
    type('rav');
    expect(options().map((o) => o.textContent)).toEqual(['RavenSheet 2 of 12', 'Raven: RoadmapSection', 'Raven: Build photosSection']);
    expect(Array.from(document.querySelectorAll('mark.ar-cmdk__hit')).map((m) => m.textContent)).toEqual(['Rav', 'Rav', 'Rav']);
    expect(activeOption()?.textContent).toBe('RavenSheet 2 of 12');
  });

  it('moves the active result with Down and Up, round the list, focus staying in the field', async () => {
    await openByButton();
    const field = input();
    key(field, { key: 'ArrowDown' });
    key(field, { key: 'ArrowDown' });
    expect(activeOption()?.textContent).toBe('Build logPage');
    expect(field.getAttribute('aria-activedescendant')).toBe(activeOption()!.id);
    key(field, { key: 'ArrowUp' });
    key(field, { key: 'ArrowUp' });
    key(field, { key: 'ArrowUp' });
    expect(activeOption()?.textContent).toBe('Raven: Build photosSection');
    key(field, { key: 'ArrowDown' });
    expect(activeOption()?.textContent).toBe('HomePage');
    expect(document.activeElement).toBe(field);
  });

  it('leaves Shift with an arrow to the field, where it selects text', async () => {
    await openByButton();
    const event = key(input(), { key: 'ArrowDown', shiftKey: true });
    expect(event.defaultPrevented).toBe(false);
    expect(activeOption()?.textContent).toBe('HomePage');
  });

  it('says what to try when nothing matches, and closes the list', async () => {
    await openByButton();
    type('zzz');
    expect(options()).toHaveLength(0);
    expect(input().getAttribute('aria-expanded')).toBe('false');
    expect(input().hasAttribute('aria-activedescendant')).toBe(false);
    expect(document.querySelector('.ar-cmdk__empty')?.textContent).toBe('No match for "zzz". Try a project name or a page: Projects, Build log.');
    const event = key(input(), { key: 'Enter' });
    expect(route.followed).toEqual([]);
    expect(event.defaultPrevented).toBe(true);
  });

  it('reads the count politely once typing pauses, and what to try when nothing matches', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await act(async () => button().click());
    for (let i = 0; i < 5; i += 1) await act(async () => vi.advanceTimersByTimeAsync(0));
    const status = document.querySelector('.ar-cmdk [role="status"]')!;
    await act(async () => vi.advanceTimersByTimeAsync(600));
    expect(status.textContent).toBe('6 results');
    type('r');
    type('ra');
    type('rav');
    await act(async () => vi.advanceTimersByTimeAsync(200));
    expect(status.textContent).toBe('6 results');
    await act(async () => vi.advanceTimersByTimeAsync(400));
    expect(status.textContent).toBe('3 results');
    type('raven road');
    await act(async () => vi.advanceTimersByTimeAsync(600));
    expect(status.textContent).toBe('1 result');
    type('zzz');
    await act(async () => vi.advanceTimersByTimeAsync(600));
    // The empty state's own sentence, the one drawn in place of the list.
    const sentence = 'No match for "zzz". Try a project name or a page: Projects, Build log.';
    expect(document.querySelector('.ar-cmdk__empty')?.textContent).toBe(sentence);
    expect(status.textContent).toBe(sentence);
    type('zzzq');
    await act(async () => vi.advanceTimersByTimeAsync(600));
    expect(status.textContent).toBe('No match for "zzzq". Try a project name or a page: Projects, Build log.');
  });
});

describe('going to a result', () => {
  it("follows the active result on Enter, closes, and focuses the new page's main once it is shown", async () => {
    await openByButton();
    type('build log');
    key(input(), { key: 'Enter' });
    await settle();
    expect(route.followed).toEqual(['/log']);
    expect(dialog()).toBeNull();
    expect(document.documentElement.style.overflow).toBe('');
    // The router has not shown the page yet: focus waits for it, and does not go back to the button.
    expect(document.activeElement).not.toBe(button());
    expect(document.activeElement).not.toBe(main());
    await showRoute('/log');
    expect(document.activeElement).toBe(main());
    // main is the skip link's target, focusable already: nothing is added to it.
    expect(main().getAttribute('tabindex')).toBe('-1');
  });

  it('follows a clicked result the same way, a project included', async () => {
    await openByButton();
    await act(async () => options()[3].click());
    await settle();
    expect(route.followed).toEqual(['/projects/raven']);
    expect(dialog()).toBeNull();
    await showRoute('/projects/raven');
    expect(document.activeElement).toBe(main());
  });

  it('forgets where focus was to go if the visitor goes elsewhere first', async () => {
    await openByButton();
    type('build log');
    key(input(), { key: 'Enter' });
    await settle();
    await showRoute('/about');
    expect(document.activeElement).not.toBe(main());
    await showRoute('/log');
    expect(document.activeElement).not.toBe(main());
  });

  it('returns focus to the button when the result is the page already shown', async () => {
    await openByButton();
    key(input(), { key: 'Enter' });
    await settle();
    expect(route.followed).toEqual(['/']);
    expect(document.activeElement).toBe(button());
  });

  it('leaves the palette open for a click that opens a new tab', async () => {
    await openByButton();
    await act(async () => options()[1].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true })));
    await settle();
    expect(dialog()).not.toBeNull();
  });

  it("focuses a chosen section's heading once its page shows it", async () => {
    await openByButton();
    type('roadmap');
    key(input(), { key: 'Enter' });
    await settle();
    expect(route.followed).toEqual(['/projects/raven#rv-e']);
    const heading = document.getElementById('rv-e')!;
    expect(document.activeElement).not.toBe(heading);
    await showRoute('/projects/raven');
    expect(document.activeElement).toBe(heading);
    expect(heading.getAttribute('tabindex')).toBe('-1');
    act(() => heading.blur());
    expect(heading.hasAttribute('tabindex')).toBe(false);
  });

  it('focuses a section on the page already shown at once', async () => {
    await showRoute('/projects/raven');
    await openByButton();
    type('build photos');
    key(input(), { key: 'Enter' });
    await settle();
    expect(document.activeElement).toBe(document.getElementById('rv-h'));
  });
});

describe('closing', () => {
  it('closes on Escape and returns focus to the button that opened it', async () => {
    await openByButton();
    // The palette's Escape is its own: nothing else on the page hears it.
    const elsewhere = vi.fn();
    window.addEventListener('keydown', elsewhere);
    const event = key(input(), { key: 'Escape' });
    window.removeEventListener('keydown', elsewhere);
    await settle();
    expect(event.defaultPrevented).toBe(true);
    expect(elsewhere).not.toHaveBeenCalled();
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(button());
    expect(button().getAttribute('aria-expanded')).toBe('false');
    expect(document.documentElement.style.overflow).toBe('');
  });

  it('closes on Close and on the scrim the same way', async () => {
    await openByButton();
    await act(async () => document.querySelector<HTMLButtonElement>('.ar-cmdk__close')!.click());
    await settle();
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(button());
    await openByButton();
    await act(async () => document.querySelector<HTMLElement>('.ar-cmdk__scrim')!.click());
    await settle();
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(button());
  });

  it('closes on a route change, without taking focus back', async () => {
    await openByButton();
    await showRoute('/about');
    expect(dialog()).toBeNull();
  });
});

describe('a palette still loading', () => {
  it('marks the button busy, and Escape calls it off: it does not open when it arrives', async () => {
    const release = holdIndex();
    await act(async () => button().click());
    expect(button().getAttribute('aria-busy')).toBe('true');
    expect(button().getAttribute('aria-expanded')).toBe('false');
    const escape = key(document.body, { key: 'Escape' });
    // The page still hears its Escape: nothing was drawn to answer it.
    expect(escape.defaultPrevented).toBe(false);
    expect(button().hasAttribute('aria-busy')).toBe(false);
    await release();
    expect(dialog()).toBeNull();
    expect(button().getAttribute('aria-expanded')).toBe('false');
  });

  it('is called off by the button or the shortcut pressed again', async () => {
    const release = holdIndex();
    await act(async () => button().click());
    await act(async () => button().click());
    expect(button().hasAttribute('aria-busy')).toBe(false);
    key(document.body, { key: 'k', ctrlKey: true });
    expect(button().getAttribute('aria-busy')).toBe('true');
    expect(key(document.body, { key: 'k', ctrlKey: true }).defaultPrevented).toBe(true);
    expect(button().hasAttribute('aria-busy')).toBe(false);
    await release();
    expect(dialog()).toBeNull();
  });

  it('stays closed if focus has moved on by the time it arrives', async () => {
    const release = holdIndex();
    const link = document.getElementById('before')!;
    act(() => button().focus());
    await act(async () => button().click());
    act(() => link.focus());
    await release();
    expect(dialog()).toBeNull();
    expect(button().hasAttribute('aria-busy')).toBe(false);
    expect(document.activeElement).toBe(link);
    // The next request opens it at once.
    await openByButton();
    expect(dialog()).not.toBeNull();
  });

  it('opens for the latest request only, when one before it was called off', async () => {
    const release = holdIndex();
    const link = document.getElementById('before')!;
    act(() => link.focus());
    key(link, { key: 'k', ctrlKey: true });
    key(link, { key: 'Escape' });
    act(() => button().focus());
    await act(async () => button().click());
    await release();
    expect(dialog()).not.toBeNull();
    expect(document.activeElement).toBe(input());
    key(input(), { key: 'Escape' });
    await settle();
    expect(document.activeElement).toBe(button());
  });
});

describe('the focus trap', () => {
  it('keeps Tab and Shift+Tab in the field when the field is all there is (1024 px and up)', async () => {
    const rects = vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(function (this: Element) {
      return { length: this.classList.contains('ar-cmdk__close') ? 0 : 1 } as DOMRectList;
    });
    await openByButton();
    expect(key(input(), { key: 'Tab' }).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(input());
    key(input(), { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(input());
    rects.mockRestore();
  });

  it('moves between the field and Close, and only them, under 768 px', async () => {
    const rects = vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue({ length: 1 } as DOMRectList);
    await openByButton();
    const close = document.querySelector<HTMLButtonElement>('.ar-cmdk__close')!;
    key(input(), { key: 'Tab' });
    expect(document.activeElement).toBe(close);
    key(close, { key: 'Tab' });
    expect(document.activeElement).toBe(input());
    key(input(), { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(close);
    // Enter on Close presses Close; it does not follow a result.
    expect(key(close, { key: 'Enter' }).defaultPrevented).toBe(false);
    rects.mockRestore();
  });

  it('brings focus back to the field if something outside takes it', async () => {
    await openByButton();
    act(() => document.getElementById('before')!.focus());
    expect(document.activeElement).toBe(input());
  });

  it('answers Tab and Escape where focus has fallen to the page, as when the field is hidden', async () => {
    const rects = vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(function (this: Element) {
      return { length: this.classList.contains('ar-cmdk__close') ? 0 : 1 } as DOMRectList;
    });
    await openByButton();
    act(() => input().blur());
    expect(document.activeElement).toBe(document.body);
    expect(key(document.body, { key: 'Tab' }).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(input());
    act(() => input().blur());
    expect(key(document.body, { key: 'Tab', shiftKey: true }).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(input());
    act(() => input().blur());
    const escape = key(document.body, { key: 'Escape' });
    await settle();
    expect(escape.defaultPrevented).toBe(true);
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(button());
    rects.mockRestore();
  });

  it('leaves Tab with Ctrl or Alt, and keys typed while an input method composes, to the browser', async () => {
    await openByButton();
    expect(key(input(), { key: 'Tab', ctrlKey: true }).defaultPrevented).toBe(false);
    expect(key(input(), { key: 'Escape', isComposing: true }).defaultPrevented).toBe(false);
    expect(dialog()).not.toBeNull();
  });
});

describe('the shortcut', () => {
  it('opens with Ctrl+K from anywhere but a field, and returns focus to what had it', async () => {
    const link = document.getElementById('before')!;
    link.focus();
    const event = key(link, { key: 'k', ctrlKey: true });
    await settle();
    expect(event.defaultPrevented).toBe(true);
    expect(dialog()).not.toBeNull();
    expect(document.activeElement).toBe(input());
    key(input(), { key: 'Escape' });
    await settle();
    expect(document.activeElement).toBe(link);
  });

  it('opens with Cmd+K, and Cmd+K or Ctrl+K again closes', async () => {
    key(document.body, { key: 'k', metaKey: true });
    await settle();
    expect(dialog()).not.toBeNull();
    const again = key(input(), { key: 'k', ctrlKey: true });
    await settle();
    expect(again.defaultPrevented).toBe(true);
    expect(dialog()).toBeNull();
  });

  it('is left to the field and the browser while the visitor types in a field', async () => {
    const field = document.getElementById('field')!;
    field.focus();
    const event = key(field, { key: 'k', ctrlKey: true });
    await settle();
    expect(event.defaultPrevented).toBe(false);
    expect(dialog()).toBeNull();
    expect(fetchCalls).toBe(0);
  });

  it('is left alone with another modifier, and does nothing over another layer', async () => {
    expect(key(document.body, { key: 'K', ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(false);
    const menu = document.createElement('div');
    menu.setAttribute('role', 'dialog');
    menu.setAttribute('aria-modal', 'true');
    document.body.appendChild(menu);
    const event = key(document.body, { key: 'k', ctrlKey: true });
    await settle();
    expect(event.defaultPrevented).toBe(false);
    expect(dialog()).toBe(menu);
    expect(document.querySelector('.ar-cmdk')).toBeNull();
  });

  it('does not open twice from a held key', async () => {
    key(document.body, { key: 'k', ctrlKey: true });
    await settle();
    const held = key(input(), { key: 'k', ctrlKey: true, repeat: true });
    await settle();
    expect(held.defaultPrevented).toBe(true);
    expect(dialog()).not.toBeNull();
  });

  it('tries again after a failed load', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 503 })));
    await openByButton();
    expect(dialog()).toBeNull();
    expect(button().getAttribute('aria-expanded')).toBe('false');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(INDEX), { status: 200 })));
    await openByButton();
    expect(dialog()).not.toBeNull();
  });
});
