/**
 * The gallery on Motion+ Carousel (components/viewers/image/Gallery.tsx and strip.ts; motion sheet
 * 6.4 and 8.1; DESIGN_DIRECTION.md 6.3 and 6.4): the strip's arithmetic between Carousel's
 * measurements and the frames, the numbers Carousel is given, the server's markup with the real
 * Carousel (the frames where they rest, nothing hidden, one labelled region, touch scrolling free),
 * the single figure, and the stylesheet. The behavior in a page is in media-gallery-strip.test.ts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  clampInset,
  frameInset,
  frameInView,
  headsPastEnd,
  nearestFrame,
  nearestRest,
  stripMotion,
  swapTransition,
  wheelAlong,
  type FramePosition,
} from '../components/viewers/image/strip';
import type { ResolvedMedia } from '../lib/media';
import { media, spring } from '../lib/motion';

// The gallery reads the path through useMotionOk(); a public page.
vi.mock('next/navigation', () => ({ usePathname: () => '/projects/raven' }));

/**
 * Four frames as Carousel measures them in an 800 px column: a square photo, a wide one, and two
 * tall ones, 16 px apart. Together 1,672 px long, so the strip travels 872 px, and the last two
 * frames both rest at that end.
 */
const FRAMES: FramePosition[] = [
  { start: 0, end: 440 },
  { start: 456, end: 1144 },
  { start: 1160, end: 1408 },
  { start: 1424, end: 1672 },
];
const MAX = 872;

describe('the strip arithmetic (strip.ts)', () => {
  it('starts a frame at the left edge, or as near as the end allows', () => {
    expect(FRAMES.map((_, index) => frameInset(FRAMES, index, MAX))).toEqual([0, 456, 872, 872]);
    // Unmeasured: no end yet.
    expect(frameInset(FRAMES, 3, null)).toBe(1424);
    // Every frame fits: the strip never moves.
    expect(frameInset(FRAMES, 2, 0)).toBe(0);
    // Positions count from the first frame, wherever the list starts.
    const shifted = FRAMES.map(({ start, end }) => ({ start: start + 4, end: end + 4 }));
    expect(frameInset(shifted, 1, MAX)).toBe(456);
  });

  it('holds an inset to the travel', () => {
    expect(clampInset(-30, MAX)).toBe(0);
    expect(clampInset(900, MAX)).toBe(MAX);
    expect(clampInset(300, MAX)).toBe(300);
    expect(clampInset(900, null)).toBe(900);
  });

  it('names the frame starting nearest the left edge for the counter', () => {
    expect(nearestFrame(FRAMES, 0)).toBe(0);
    expect(nearestFrame(FRAMES, 200)).toBe(0);
    expect(nearestFrame(FRAMES, 300)).toBe(1);
    expect(nearestFrame(FRAMES, 700)).toBe(1);
    // Resting at the end: the third frame starts nearest the left edge.
    expect(nearestFrame(FRAMES, MAX)).toBe(2);
    expect(nearestFrame([], 300)).toBe(0);
  });

  it('settles a strip let go without motion on the nearest place it can rest', () => {
    // 700 px: the end (872) is nearer than the wide frame's start (456).
    expect(nearestRest(FRAMES, 700, MAX)).toBe(2);
    expect(nearestRest(FRAMES, 600, MAX)).toBe(1);
    expect(nearestRest(FRAMES, 100, MAX)).toBe(0);
    // Two frames share the end: the first of them.
    expect(nearestRest(FRAMES, 2000, MAX)).toBe(2);
  });

  it('knows whether a frame lies wholly inside the strip', () => {
    // The strip is 1,672 less 872: 800 px wide.
    expect(frameInView(FRAMES, 0, 0, MAX)).toBe(true);
    expect(frameInView(FRAMES, 1, 0, MAX)).toBe(false);
    expect(frameInView(FRAMES, 1, 456, MAX)).toBe(true);
    expect(frameInView(FRAMES, 3, 456, MAX)).toBe(false);
    expect(frameInView(FRAMES, 2, MAX, MAX)).toBe(true);
    expect(frameInView(FRAMES, 3, MAX, MAX)).toBe(true);
    // A frame wider than the strip is never wholly inside it.
    const wide = [{ start: 0, end: 300 }, { start: 316, end: 1492 }, { start: 1508, end: 1756 }];
    expect(frameInView(wide, 1, 316, 956)).toBe(false);
    // Unmeasured, or every frame fits: nothing to bring into view.
    expect(frameInView(FRAMES, 3, 0, null)).toBe(true);
    expect(frameInView(FRAMES, 3, 0, 0)).toBe(true);
  });

  it('reads a wheel along the strip as Carousel does: sideways, or vertical with Shift, and not mostly across', () => {
    expect(wheelAlong({ deltaX: 40, deltaY: 3, shiftKey: false })).toBe(40);
    expect(wheelAlong({ deltaX: -40, deltaY: -40, shiftKey: false })).toBe(-40);
    // Mostly vertical: the page's scroll.
    expect(wheelAlong({ deltaX: 3, deltaY: 40, shiftKey: false })).toBe(0);
    // Shift turns a vertical wheel sideways.
    expect(wheelAlong({ deltaX: 0, deltaY: -40, shiftKey: true })).toBe(-40);
    expect(wheelAlong({ deltaX: 40, deltaY: 3, shiftKey: true })).toBe(0);
  });

  it('knows a move that would push the strip past the end it rests at', () => {
    expect(headsPastEnd(0, MAX, -10)).toBe(true);
    expect(headsPastEnd(0, MAX, 10)).toBe(false);
    expect(headsPastEnd(MAX, MAX, 10)).toBe(true);
    expect(headsPastEnd(MAX, MAX, -10)).toBe(false);
    expect(headsPastEnd(456, MAX, 10)).toBe(false);
    expect(headsPastEnd(456, MAX, -10)).toBe(false);
    // Within half a pixel of an end is at it.
    expect(headsPastEnd(MAX - 0.3, MAX, 10)).toBe(true);
    // Every frame fits: both ways are past an end.
    expect(headsPastEnd(0, 0, 10)).toBe(true);
    expect(headsPastEnd(0, 0, -10)).toBe(true);
    // Unmeasured, or no move.
    expect(headsPastEnd(0, null, -10)).toBe(false);
    expect(headsPastEnd(0, MAX, 0)).toBe(false);
  });
});

describe('the numbers Carousel is given (lib/motion.ts media.gallery)', () => {
  it('moves with the snap spring and stretches a fifth of the travel past the ends', () => {
    expect(media.gallery.snap).toBe(spring.snap);
    expect(media.gallery.overdrag).toBe(0.2);
    expect(stripMotion(true)).toEqual({ transition: spring.snap, elastic: 0.2 });
  });

  it('keeps the glide on record: Motion inertia, which Carousel has no option for', () => {
    expect(media.gallery.glide).toEqual({ power: 0.8, timeConstant: 325 });
  });

  it('moves at once and stops at the ends without motion (sheet 8.1)', () => {
    expect(media.gallery.atOnce).toEqual({ duration: 0 });
    expect(stripMotion(false)).toEqual({ transition: { duration: 0 }, elastic: 0 });
  });

  it('swaps what one transition object says, for the paging Carousel keeps from its first render', () => {
    const held: Record<string, unknown> = { ...spring.snap };
    swapTransition(held, media.gallery.atOnce);
    expect(held).toEqual({ duration: 0 });
    swapTransition(held, spring.snap);
    expect(held).toEqual(spring.snap);
  });
});

describe('the server markup, with the real Carousel', () => {
  const photo = (n: number, width = 1600, height = 1000): ResolvedMedia => ({
    kind: 'image',
    file: { src: `/dev/samples/photo-${n}.webp`, name: `photo-${n}.webp`, ext: 'webp', typeLabel: 'WebP image', downloadHref: `/dev/samples/photo-${n}.webp` },
    alt: '',
    width,
    height,
    store: 'repo',
  });

  async function render(items: ResolvedMedia[]): Promise<string> {
    const { default: Gallery } = await import('../components/viewers/image/Gallery');
    return renderToString(createElement(Gallery, { items }));
  }

  it('draws the frames in a strip as it rests, inside one labelled region, with the bar after it', async () => {
    const html = await render([photo(1), photo(2, 900, 1600), photo(3)]);
    // The section is the gallery's region; Carousel's box is not a second one.
    expect(html).toMatch(/^<section class="ar-gal" aria-label="Gallery" aria-roledescription="gallery">/);
    expect(html).not.toContain('role="region"');
    expect(html).not.toContain('aria-roledescription="carousel"');
    // Carousel's box: clipped sideways, and a vertical swipe still scrolls the page.
    const box = /<div class="mm-gal"[^>]*style="([^"]*)"/.exec(html)?.[1] ?? '';
    expect(box).toContain('overflow-x:clip');
    expect(box).toContain('touch-action:pan-y');
    // One item per frame, no copies (no loop), each frame its button.
    expect(html.match(/class="ticker-item"/g)).toHaveLength(3);
    expect(html).not.toContain('clone-item');
    expect(html.match(/class="ar-gal__frame"/g)).toHaveLength(3);
    expect(html).toContain('Open item 2 of 3');
    // The bar: Previous phantom at the first frame, Next, and the counter.
    expect(html).toMatch(/<div class="ar-gal__bar"><button type="button" class="ar-iconbtn" aria-label="Previous" title="Previous" aria-disabled="true">/);
    expect(html).toMatch(/aria-label="Next" title="Next">/);
    expect(html).toContain('<p class="ar-gal__count" aria-live="polite">1 of 3</p>');
    // Nothing waits hidden for scripts: the photos as they are (the list's own opacity is overruled
    // by the stylesheet, below).
    expect(html).toContain('mm-photo');
    expect(html).not.toContain('data-arrive');
  });

  it('draws one photo as a single figure: no strip, no drag, no bar, no counter', async () => {
    const html = await render([photo(1)]);
    expect(html).toMatch(/^<section class="ar-gal ar-gal--single" aria-label="Gallery">/);
    expect(html).not.toContain('aria-roledescription');
    expect(html).not.toContain('mm-gal');
    expect(html).not.toContain('touch-action');
    expect(html).not.toContain('ar-gal__bar');
    expect(html).toContain('<ul class="ar-gal__track"><li class="ar-gal__item"><button type="button" class="ar-gal__frame"');
    expect(html).toContain('Open image');
  });
});

describe("the strip's stylesheet (app/motion-media.css)", () => {
  const rules = fs.readFileSync(path.resolve('app/motion-media.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

  it("shows Carousel's list from the first paint", () => {
    expect(rules).toMatch(/\.mm-gal > ul \{\s*opacity: 1 !important;\s*\}/);
  });

  it("keeps the native track's room for a focus ring, with a clip for browsers without overflow: clip", () => {
    const box = /\.mm-gal \{([\s\S]*?)\}/.exec(rules)?.[1] ?? '';
    expect(box).toContain('overflow-x: hidden;');
    expect(box).toContain('margin: calc(-1 * var(--space-1));');
    expect(box).toContain('padding: var(--space-1) var(--space-1) var(--space-3);');
    const track = fs.readFileSync(path.resolve('app/sheet.css'), 'utf8');
    expect(track).toContain('margin: calc(-1 * var(--space-1)); padding: var(--space-1) var(--space-1) var(--space-3);');
  });

  it("gives a frame's drawn extras no pointer, so a press lands on the frame", () => {
    expect(rules).toMatch(/\.mm-gal \[aria-hidden='true'\] \{\s*pointer-events: none;\s*\}/);
  });
});
