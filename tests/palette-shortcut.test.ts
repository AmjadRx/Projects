// @vitest-environment jsdom
/**
 * The palette's shortcut and its loading (components/palette/shortcut.ts, load.ts): Ctrl or Cmd
 * with K and nothing else; never while the visitor types in a field; never over another layer; and
 * the palette's code and index fetched together, once, ahead of use at an idle moment after the
 * page has loaded (not before, and not when the visitor saves data).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { inPalette, isPaletteShortcut, isTypingTarget, otherLayerOpen, type ShortcutKey } from '../components/palette/shortcut';
import { loadPalette, PALETTE_INDEX_URL, prefetchWhenIdle, resetPaletteLoad } from '../components/palette/load';

const press = (key: string, mods: Partial<ShortcutKey> = {}): ShortcutKey => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  resetPaletteLoad();
});

describe('the shortcut', () => {
  it('is Ctrl+K or Cmd+K, on any system, either case of the letter', () => {
    expect(isPaletteShortcut(press('k', { ctrlKey: true }))).toBe(true);
    expect(isPaletteShortcut(press('k', { metaKey: true }))).toBe(true);
    expect(isPaletteShortcut(press('K', { ctrlKey: true }))).toBe(true);
  });

  it('leaves the browser its own shortcuts: other modifiers with K, and other keys with Ctrl or Cmd', () => {
    expect(isPaletteShortcut(press('K', { ctrlKey: true, shiftKey: true }))).toBe(false); // Firefox's web console
    expect(isPaletteShortcut(press('k', { ctrlKey: true, altKey: true }))).toBe(false); // AltGr+K
    expect(isPaletteShortcut(press('k', { metaKey: true, altKey: true }))).toBe(false); // Cmd+Option+K
    expect(isPaletteShortcut(press('k', { ctrlKey: true, metaKey: true }))).toBe(false);
    expect(isPaletteShortcut(press('k'))).toBe(false);
    for (const key of ['l', 't', 'w', 'f', 'Enter', 'F5']) expect(isPaletteShortcut(press(key, { ctrlKey: true })), key).toBe(false);
  });

  it('reads the letter, not the key position, where the layout types another Latin letter there', () => {
    // Dvorak: the key in K's place types T, and Ctrl+T must stay the browser's new tab.
    expect(isPaletteShortcut(press('t', { ctrlKey: true, code: 'KeyK' }))).toBe(false);
    // ...while Dvorak's own K, in another place, is the shortcut.
    expect(isPaletteShortcut(press('k', { ctrlKey: true, code: 'KeyV' }))).toBe(true);
  });

  it("reads the key's place where the layout has no Latin letters", () => {
    expect(isPaletteShortcut(press('л', { ctrlKey: true, code: 'KeyK' }))).toBe(true);
    expect(isPaletteShortcut(press('д', { ctrlKey: true, code: 'KeyL' }))).toBe(false);
  });

  it('leaves a key the page has handled, and one typed while an input method composes', () => {
    expect(isPaletteShortcut(press('k', { ctrlKey: true, defaultPrevented: true }))).toBe(false);
    expect(isPaletteShortcut(press('k', { ctrlKey: true, isComposing: true }))).toBe(false);
  });
});

describe('where the visitor is typing', () => {
  function put(html: string): HTMLElement {
    document.body.innerHTML = html;
    return document.getElementById('t') as HTMLElement;
  }

  it('counts every text field, text areas, selects, and editable regions', () => {
    for (const type of ['text', 'search', 'email', 'url', 'tel', 'password', 'number', 'date']) {
      expect(isTypingTarget(put(`<input id="t" type="${type}">`)), type).toBe(true);
    }
    expect(isTypingTarget(put('<input id="t">'))).toBe(true);
    expect(isTypingTarget(put('<textarea id="t"></textarea>'))).toBe(true);
    expect(isTypingTarget(put('<select id="t"><option>a</option></select>'))).toBe(true);
    expect(isTypingTarget(put('<div contenteditable="true"><p id="t">x</p></div>'))).toBe(true);
    expect(isTypingTarget(put('<div id="t" contenteditable="">x</div>'))).toBe(true);
    expect(isTypingTarget(put('<div id="t" role="textbox" tabindex="0"></div>'))).toBe(true);
  });

  it('does not count buttons, links, checkboxes, sliders, the page, or a region made not editable', () => {
    expect(isTypingTarget(put('<button id="t">x</button>'))).toBe(false);
    expect(isTypingTarget(put('<a id="t" href="/">x</a>'))).toBe(false);
    for (const type of ['checkbox', 'radio', 'range', 'button', 'submit']) {
      expect(isTypingTarget(put(`<input id="t" type="${type}">`)), type).toBe(false);
    }
    expect(isTypingTarget(put('<div contenteditable="false"><p id="t">x</p></div>'))).toBe(false);
    expect(isTypingTarget(document.body)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget(window)).toBe(false);
  });
});

describe('other layers', () => {
  it('sees the menu, the lightbox, or a viewer held full screen as another layer', () => {
    expect(otherLayerOpen(document)).toBe(false);
    document.body.innerHTML = '<div role="dialog" aria-modal="true" class="ar-mmenu"></div>';
    expect(otherLayerOpen(document)).toBe(true);
  });

  it('does not count the palette itself', () => {
    document.body.innerHTML = '<div class="ar-cmdk"><div role="dialog" aria-modal="true"><input id="f"></div></div>';
    expect(otherLayerOpen(document)).toBe(false);
    expect(inPalette(document.getElementById('f'))).toBe(true);
    expect(inPalette(document.body)).toBe(false);
    expect(inPalette(null)).toBe(false);
  });

  it("counts the browser's own full screen", () => {
    const doc = { fullscreenElement: document.body, querySelectorAll: () => [] } as unknown as Document;
    expect(otherLayerOpen(doc)).toBe(true);
  });
});

describe('loading on demand', () => {
  const INDEX = { groups: [{ label: 'Pages', items: [{ label: 'Home', meta: 'Page', href: '/' }] }], pages: [] };

  it('fetches the code and the index once, together, and again only after a failure', async () => {
    const fetch = vi.fn(async (_url: string) => new Response(JSON.stringify(INDEX), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const [a, b] = await Promise.all([loadPalette(), loadPalette()]);
    expect(a).toBe(b);
    expect(a.index).toEqual(INDEX);
    expect(typeof a.Palette).toBe('function');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe(PALETTE_INDEX_URL);

    resetPaletteLoad();
    fetch.mockImplementationOnce(async () => new Response('nope', { status: 503 }));
    await expect(loadPalette()).rejects.toThrow();
    await expect(loadPalette()).resolves.toMatchObject({ index: INDEX });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('refuses an index that is not one', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ hello: 1 }), { status: 200 })));
    await expect(loadPalette()).rejects.toThrow();
  });
});

describe('the idle fetch', () => {
  /** A window whose load event, idle callbacks, and data saving the test controls. */
  function fakeWindow({ complete = false, idle = true, saveData = false } = {}) {
    const listeners = new Map<string, () => void>();
    const idles: (() => void)[] = [];
    const win = {
      navigator: { connection: { saveData } },
      document: { readyState: complete ? 'complete' : 'loading', querySelector: () => null },
      addEventListener: (type: string, fn: () => void) => listeners.set(type, fn),
      removeEventListener: (type: string) => listeners.delete(type),
      ...(idle
        ? {
            requestIdleCallback: (fn: () => void) => idles.push(fn),
            cancelIdleCallback: () => {
              idles.length = 0;
            },
          }
        : {}),
    } as unknown as Window;
    return { win, fire: (type: string) => listeners.get(type)?.(), idles };
  }

  it('waits for the load event, then for an idle moment, then fetches', () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(INDEX_EMPTY)));
    vi.stubGlobal('fetch', fetch);
    const { win, fire, idles } = fakeWindow();
    prefetchWhenIdle(win);
    expect(idles).toHaveLength(0);
    fire('load');
    expect(idles).toHaveLength(1);
    expect(fetch).not.toHaveBeenCalled();
    idles[0]();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('goes straight to the idle wait on a page that has already loaded, and can be cancelled', () => {
    const { win, idles } = fakeWindow({ complete: true });
    const cancel = prefetchWhenIdle(win);
    expect(idles).toHaveLength(1);
    cancel();
    expect(idles).toHaveLength(0);
  });

  it('fetches nothing ahead when the visitor saves data', () => {
    const { win, fire, idles } = fakeWindow({ saveData: true });
    prefetchWhenIdle(win);
    fire('load');
    expect(idles).toHaveLength(0);
  });

  it('waits a moment instead where the browser has no idle callback', () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => new Response(JSON.stringify(INDEX_EMPTY)));
    vi.stubGlobal('fetch', fetch);
    const { win } = fakeWindow({ complete: true, idle: false });
    prefetchWhenIdle(win);
    expect(fetch).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5000);
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

const INDEX_EMPTY = { groups: [], pages: [] };
