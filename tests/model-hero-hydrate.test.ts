// @vitest-environment jsdom
/**
 * The hero model's server markup hydrates as it is (HeroModelViewer.tsx; the brief: "the server
 * render must match the first client render"). The markup comes from renderToString, as on the
 * server, and the client renders over it with hydrateRoot, as the browser does: React must take
 * over the server's own elements, with no mismatch and no client render from scratch. Then the
 * effects run as on a phone: the poster's button arrives, and nothing loads by itself.
 */
import { act, createElement } from 'react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HeroModelViewer from '@/components/viewers/model/HeroModelViewer';
import { UI } from '@/lib/strings';
import { HERO_MEDIA } from './fixtures/hero-media';

// Hoisted above the imports by Vitest: useMotionOk reads the path.
vi.mock('next/navigation', () => ({ usePathname: () => '/' }));

/** A phone: no query matches, so no fine pointer and no reduced motion. */
function phoneMatchMedia(query: string): MediaQueryList {
  return {
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  } as MediaQueryList;
}

class InertResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

describe('HeroModelViewer hydrates its server markup', () => {
  let root: Root | null = null;
  let container: HTMLElement;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('matchMedia', phoneMatchMedia);
    vi.stubGlobal('ResizeObserver', InertResizeObserver);
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('keeps the server elements, with no mismatch, then offers the load button on a phone', () => {
    const props = { media: HERO_MEDIA, caption: UI.heroCaption };
    container.innerHTML = renderToString(createElement(HeroModelViewer, props));
    const serverPoster = container.querySelector('.hm-model__poster img');
    const serverCaption = container.querySelector('figcaption');
    expect(serverPoster).not.toBeNull();

    const errors: unknown[] = [];
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    act(() => {
      root = hydrateRoot(container, createElement(HeroModelViewer, props), { onRecoverableError: (error) => errors.push(error) });
    });

    expect(errors).toEqual([]);
    const hydrationWarnings = consoleError.mock.calls.filter((call) => /hydrat|did not match|server/i.test(String(call[0])));
    expect(hydrationWarnings).toEqual([]);
    // The same elements the server sent: React took them over instead of drawing its own.
    expect(container.querySelector('.hm-model__poster img')).toBe(serverPoster);
    expect(container.querySelector('figcaption')).toBe(serverCaption);
    expect(container.querySelector('figure')?.lastElementChild).toBe(serverCaption);

    // After the effects, as on a phone: the poster waits for a tap; no engine, no canvas.
    const load = [...container.querySelectorAll('.ar-mv__play button')].map((button) => button.textContent);
    expect(load).toEqual([UI.viewers.model.load]);
    expect(container.querySelector('[role="application"]')).toBeNull();
    expect(container.querySelector('canvas')).toBeNull();
  });
});
