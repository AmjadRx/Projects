// @vitest-environment jsdom
/**
 * The phone strip of featured projects (DESIGN_DIRECTION.md 6.4 and 7; components/home/
 * FeaturedStrip.tsx): what the server draws, when the Motion+ Carousel takes the strip's place
 * (never in the window, and never under reduced motion or the pause control), and what the strip
 * does around it: the marks, Previous and Next, the arrow keys, focus as the two trade places, the
 * click that ends a drag, the browser's own link drag, and the rise of cards that were still
 * waiting. The Carousel itself is faked here (tests/home-motion-plus.test.ts renders PhoneCarousel
 * against a fake Motion+ Carousel; the browser checks cover the real one).
 */
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { media, page, spring } from '../lib/motion';
import { setMotionPaused } from '../lib/motionPause';

type Api = import('../components/home/PhoneCarousel').StripApi;
type CarouselProps = import('../components/home/PhoneCarousel').PhoneCarouselProps;

const state = vi.hoisted(() => ({
  motionOk: true,
  props: null as null | Record<string, unknown>,
  rises: [] as Element[],
}));

vi.mock('next/navigation', () => ({ usePathname: () => '/' }));
vi.mock('../lib/useMotionOk', () => ({ useMotionOk: () => state.motionOk, motionOk: () => state.motionOk }));
vi.mock('../components/site/risePanels', () => ({
  startPanelRise: (root: Element) => {
    state.rises.push(root);
    return () => {};
  },
}));
// The Carousel, as FeaturedStrip mounts it: the cards in a strip of their own, and the props it was given.
vi.mock('../components/home/PhoneCarousel', () => ({
  default: (props: CarouselProps) => {
    state.props = props as unknown as Record<string, unknown>;
    return h(
      'div',
      { className: 'hm-feat hm-feat--carousel', id: props.id },
      props.items.map((item, i) => h('div', { key: i, className: 'hm-feat__item' }, item)),
    );
  },
}));

const { default: FeaturedStrip } = await import('../components/home/FeaturedStrip');

class FakeObserver {
  static made: FakeObserver[] = [];
  observed: Element[] = [];
  constructor(
    public callback: IntersectionObserverCallback,
    public options: IntersectionObserverInit = {},
  ) {
    FakeObserver.made.push(this);
  }
  observe(target: Element) {
    this.observed.push(target);
  }
  unobserve() {}
  disconnect() {
    FakeObserver.made = FakeObserver.made.filter((o) => o !== this);
  }
  takeRecords() {
    return [];
  }
  report(isIntersecting: boolean, ratio = isIntersecting ? 1 : 0, only?: Element) {
    const entries = this.observed.filter((t) => !only || t === only).map((target) => ({ target, isIntersecting, intersectionRatio: ratio }));
    this.callback(entries as unknown as IntersectionObserverEntry[], this as unknown as IntersectionObserver);
  }
}

/** The observers' margins: where the code loads, where the carousel is mounted, and where it goes. */
const MARGIN = { load: '100% 0px', near: '25% 0px', far: '50% 0px' } as const;

/** The strip crosses one of the margins, or the window's edge (`screen`): inward (true) or outward. */
function see(kind: keyof typeof MARGIN | 'screen', on: boolean) {
  const found = FakeObserver.made.filter((o) =>
    kind === 'screen' ? o.options.rootMargin === undefined && !o.options.root : o.options.rootMargin === MARGIN[kind],
  );
  for (const o of found) o.report(on);
}

async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

const labels = { region: 'Featured projects', kind: 'carousel', previous: 'Previous project', next: 'Next project' };
const card = (n: number) => h('article', { className: 'ar-card' }, h('a', { href: `/projects/p${n}`, className: 'ar-card__link' }, `Project ${n}`));
const items = [card(1), card(2), card(3)];

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.IntersectionObserver = FakeObserver as unknown as typeof IntersectionObserver;
  window.matchMedia = ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  window.requestAnimationFrame = ((cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number) as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = ((id: number) => clearTimeout(id)) as typeof window.cancelAnimationFrame;
  HTMLElement.prototype.scrollTo = vi.fn() as unknown as typeof HTMLElement.prototype.scrollTo;
});

describe('FeaturedStrip, as the server draws it', () => {
  it('the strip of cards, then the marks (hidden from assistive technology) and Previous and Next', () => {
    const html = renderToStaticMarkup(h(FeaturedStrip, { id: 'featured-work', items, labels }));
    expect(html).toContain('<div class="hm-feat-box"><div class="hm-feat" id="featured-work"><div class="hm-feat__item"><article class="ar-card">');
    expect(html).toContain('<span class="hm-swipe__dots" aria-hidden="true"><span class="hm-swipe__dot is-on"></span><span class="hm-swipe__dot"></span><span class="hm-swipe__dot"></span></span>');
    expect(html).toContain('aria-label="Previous project" title="Previous project" aria-controls="featured-work" aria-disabled="true"');
    expect(html).toMatch(/aria-label="Next project" title="Next project" aria-controls="featured-work">/);
  });

  it('one card: no marks and no buttons', () => {
    const html = renderToStaticMarkup(h(FeaturedStrip, { id: 'featured-work', items: [card(1)], labels }));
    expect(html).not.toContain('hm-swipe');
  });

  it('moves as the gallery does (motion sheet 6.4)', () => {
    expect(page.strip).toMatchObject({ maxWidth: 767, overdrag: media.gallery.overdrag, load: 1, near: 0.25, far: 0.5, shown: 0.6 });
    expect(page.strip.snap).toBe(spring.snap);
    expect(page.strip.overdrag).toBe(0.2);
  });
});

describe('FeaturedStrip in the browser', () => {
  let root: Root | null = null;
  let frame: HTMLElement;

  beforeEach(() => {
    FakeObserver.made = [];
    state.motionOk = true;
    state.props = null;
    state.rises = [];
    setMotionPaused(false);
    (HTMLElement.prototype.scrollTo as Mock).mockClear();
  });

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.replaceChildren();
    setMotionPaused(false);
  });

  function mount(width: number) {
    frame = document.createElement('div');
    frame.className = 'ar-frame';
    frame.getBoundingClientRect = () => ({ width }) as DOMRect;
    document.body.append(frame);
    root = createRoot(frame);
    act(() => root!.render(h(FeaturedStrip, { id: 'featured-work', items, labels })));
  }

  /** Draws the strip again, as React does when a setting it reads changes. */
  const redraw = () => act(() => root!.render(h(FeaturedStrip, { id: 'featured-work', items, labels })));
  /** The observers that bring the carousel (its code, its margins, the window's edge): none while it may not come. */
  const carouselObservers = () => FakeObserver.made.filter((o) => !o.options.root);

  /** The carousel's code arrives as the strip comes within a window of the view. */
  async function load() {
    await act(async () => {
      see('load', true);
      await flush();
    });
  }

  /** The strip, below the window, comes within a quarter window of it: the carousel takes over. */
  async function toCarousel() {
    await load();
    act(() => {
      see('screen', false);
      see('near', true);
    });
  }

  const carousel = () => frame.querySelector('.hm-feat--carousel') !== null;
  const dots = () => Array.from(frame.querySelectorAll('.hm-swipe__dot')).map((d) => (d.classList.contains('is-on') ? 1 : 0)).join('');
  const buttons = () => Array.from(frame.querySelectorAll<HTMLButtonElement>('.hm-swipe__nav button'));
  const links = () => Array.from(frame.querySelectorAll<HTMLAnchorElement>('.hm-feat-box a'));

  /** The carousel reports its place; `toCard` records the turns asked of it, `release` the releases. */
  function report(api: Partial<Api>) {
    const turns: number[] = [];
    act(() =>
      (state.props!.onApi as (api: Api) => void)({
        page: 0,
        pages: 3,
        canPrev: false,
        canNext: true,
        toCard: (i) => turns.push(i),
        release: () => turns.push(-1),
        ...api,
      }),
    );
    return turns;
  }

  it('keeps the grid from a 768 px frame: no carousel loads', async () => {
    mount(768);
    await toCarousel();
    expect(carousel()).toBe(false);
    expect(FakeObserver.made.filter((o) => !o.options.root)).toHaveLength(0);
  });

  it('on a phone, the Carousel takes the strip\'s place just before it shows, on the card the strip showed, and gives way when it has gone', async () => {
    mount(390);
    const strip = frame.querySelector('.hm-feat')!;
    // The strip's own card in view: the second.
    const shownObserver = FakeObserver.made.find((o) => o.options.root === strip)!;
    act(() => shownObserver.report(true, 1, strip.children[1]));
    expect(dots()).toBe('010');
    // Within a window the code loads, but the strip stays until it is a quarter window away.
    await load();
    act(() => see('screen', false));
    expect(carousel()).toBe(false);
    act(() => see('near', true));
    expect(carousel()).toBe(true);
    expect(state.props).toMatchObject({ id: 'featured-work', start: 1, label: 'Featured projects', kind: 'carousel' });
    expect(state.props).not.toHaveProperty('reduced');
    report({ page: 2, canNext: false, canPrev: true });
    act(() => see('far', false));
    expect(carousel()).toBe(false);
    // The strip comes back on the carousel's last card.
    expect(dots()).toBe('001');
  });

  it('under reduced motion, never loads or mounts the Carousel: the strip stays, and its buttons move it at once', async () => {
    state.motionOk = false;
    mount(390);
    await toCarousel();
    expect(carousel()).toBe(false);
    expect(carouselObservers()).toHaveLength(0);
    expect(state.props).toBeNull();
    act(() => buttons()[1].click());
    expect(HTMLElement.prototype.scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ behavior: 'auto' }));
  });

  it('while the visitor has paused motion, never loads or mounts the Carousel: the strip stays', async () => {
    act(() => setMotionPaused(true));
    mount(390);
    await toCarousel();
    expect(carousel()).toBe(false);
    expect(carouselObservers()).toHaveLength(0);
    expect(state.props).toBeNull();
    // The strip keeps the card in view and moves by the buttons, as with motion.
    act(() => buttons()[1].click());
    expect(HTMLElement.prototype.scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ behavior: 'smooth' }));
  });

  it('paused with the Carousel there, gives the strip its place back at once on the Carousel\'s card, focus kept; on Play the Carousel comes back once the strip is out of the window', async () => {
    mount(390);
    await toCarousel();
    report({ page: 2, canPrev: true, canNext: false });
    act(() => links()[2].focus());
    act(() => setMotionPaused(true));
    expect(carousel()).toBe(false);
    expect(dots()).toBe('001');
    expect(document.activeElement).toBe(links()[2]);
    // The strip shows the Carousel's card at once: scrolled straight to it, with no smooth scroll.
    const [options] = (HTMLElement.prototype.scrollTo as Mock).mock.calls.at(-1) as [ScrollToOptions];
    expect(options.behavior).toBe('auto');
    expect(carouselObservers()).toHaveLength(0);

    act(() => setMotionPaused(false));
    // In the window, the strip stays; once it has left it, the Carousel takes over, on the same card.
    act(() => {
      see('screen', true);
      see('near', true);
    });
    expect(carousel()).toBe(false);
    act(() => see('screen', false));
    expect(carousel()).toBe(true);
    expect(state.props).toMatchObject({ start: 2 });
  });

  it('gives the strip its place back when reduced motion is turned on with the Carousel there', async () => {
    mount(390);
    await toCarousel();
    report({ page: 1, canPrev: true });
    state.motionOk = false;
    redraw();
    expect(carousel()).toBe(false);
    expect(dots()).toBe('010');
    expect(carouselObservers()).toHaveLength(0);
  });

  it('never takes the place of a strip in the window: the strip stays until it has left it', async () => {
    mount(390);
    await load();
    // Landing on the strip (back from a project, or at #work): in view and near.
    act(() => {
      see('screen', true);
      see('near', true);
    });
    expect(carousel()).toBe(false);
    act(() => see('screen', false));
    expect(carousel()).toBe(true);
    // Once it is the carousel, it stays in view.
    act(() => see('screen', true));
    expect(carousel()).toBe(true);
  });

  it('waits for the first word on whether the strip is in the window, and checks the layout itself', async () => {
    mount(390);
    await load();
    act(() => see('near', true));
    expect(carousel()).toBe(false);
    // The observer says out, but the window has just reached the strip.
    const box = frame.querySelector('.hm-feat-box')!;
    box.getBoundingClientRect = () => ({ top: 700, bottom: 1200, left: 0, right: 390, width: 390, height: 500 }) as DOMRect;
    act(() => see('screen', false));
    expect(carousel()).toBe(false);
    // In, then out again (it has left the window): the carousel.
    box.getBoundingClientRect = () => ({ top: 900, bottom: 1400, left: 0, right: 390, width: 390, height: 500 }) as DOMRect;
    act(() => see('screen', true));
    act(() => see('screen', false));
    expect(carousel()).toBe(true);
  });

  it('a card that holds focus keeps it as the strip and the carousel trade places, both ways', async () => {
    mount(390);
    act(() => links()[1].focus());
    await toCarousel();
    expect(carousel()).toBe(true);
    expect(state.props).toMatchObject({ start: 1 });
    expect(document.activeElement).toBe(links()[1]);
    report({ page: 1, canPrev: true });
    // A keyboard user moves on to the third card, then pages the window away from the strip.
    act(() => links()[2].focus());
    act(() => see('far', false));
    expect(carousel()).toBe(false);
    expect(document.activeElement).toBe(links()[2]);
    expect(dots()).toBe('001');
  });

  it('Previous and Next turn the carousel one card; at either end the unavailable one is phantom and does nothing', async () => {
    mount(390);
    await toCarousel();
    let turns = report({ page: 0, canPrev: false, canNext: true });
    expect(buttons().map((b) => b.getAttribute('aria-disabled'))).toEqual(['true', null]);
    act(() => buttons()[0].click());
    act(() => buttons()[1].click());
    expect(turns).toEqual([1]);
    turns = report({ page: 2, canPrev: true, canNext: false });
    expect(dots()).toBe('001');
    expect(buttons().map((b) => b.getAttribute('aria-disabled'))).toEqual([null, 'true']);
    act(() => buttons()[1].click());
    act(() => buttons()[0].click());
    expect(turns).toEqual([1]);
  });

  describe('clicks', () => {
    let opened = false;
    /** A click on the first card's link (`detail` 1 from a pointer, 0 from Enter or assistive technology): whether it opens it. */
    const opens = (detail: number) => {
      opened = false;
      links()[0].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail }));
      return opened;
    };
    const press = () => links()[0].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    const drag = () => act(() => (state.props!.onDragStart as () => void)());

    beforeEach(async () => {
      mount(390);
      await toCarousel();
      // A click opens the card when it reaches the link uncancelled; then jsdom is kept from following it.
      links()[0].addEventListener('click', (event) => (opened = !event.defaultPrevented));
      frame.addEventListener('click', (event) => event.preventDefault());
    });

    it('the click that ends a drag opens nothing; a plain click does', () => {
      press();
      drag();
      expect(opens(1)).toBe(false);
      press();
      expect(opens(1)).toBe(true);
    });

    it('a click from the keyboard or assistive technology opens the card even after a swipe that ended with no click', () => {
      // A swipe: the drag starts, and no click ends it.
      press();
      drag();
      expect(opens(0)).toBe(true);
      // The next pointer click that ends a drag is still stopped.
      press();
      drag();
      expect(opens(1)).toBe(false);
    });

    it('a press the browser takes over for a page scroll leaves nothing behind', () => {
      press();
      drag();
      links()[0].dispatchEvent(new PointerEvent('pointercancel', { bubbles: true }));
      expect(opens(1)).toBe(true);
    });
  });

  it('a page scroll that starts on the carousel releases it to rest on its card; the strip has nothing to release', async () => {
    mount(390);
    const cancel = () => act(() => links()[0].dispatchEvent(new PointerEvent('pointercancel', { bubbles: true })));
    cancel();
    await toCarousel();
    const calls = report({ page: 1, canPrev: true });
    links()[0].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    act(() => (state.props!.onDragStart as () => void)());
    cancel();
    expect(calls).toEqual([-1]);
  });

  it('in the carousel a mouse press on a card never starts the browser\'s own drag of its link; the strip leaves that drag be', async () => {
    mount(390);
    const linkDrag = () => {
      const event = new Event('dragstart', { bubbles: true, cancelable: true });
      links()[0].dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(linkDrag()).toBe(false);
    await toCarousel();
    expect(linkDrag()).toBe(true);
  });

  it('the arrow keys take focus to the next or previous card, and the carousel follows focus', async () => {
    mount(390);
    await toCarousel();
    const turns = report({ page: 0 });
    act(() => links()[0].focus());
    act(() => {
      links()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    expect(document.activeElement).toBe(links()[1]);
    expect(turns).toEqual([1]);
    // At the first card, Left goes nowhere.
    act(() => links()[0].focus());
    const event = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true });
    act(() => {
      links()[0].dispatchEvent(event);
    });
    expect(document.activeElement).toBe(links()[0]);
  });

  it('cards that were still waiting to rise rise in the carousel, once', async () => {
    mount(390);
    frame.querySelector('.ar-card')!.setAttribute('data-ar-rise', '');
    await toCarousel();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    expect(state.rises).toEqual([frame.querySelector('.hm-feat-box')]);
  });

  it('cards drawn in place stay in place', async () => {
    mount(390);
    await toCarousel();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    expect(state.rises).toEqual([]);
  });
});
