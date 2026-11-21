/**
 * The motion of the owner's media (motion sheet 6; the states boards): the scroll-scrubbed video's
 * run and playhead, a photo arriving in its well, the numbers in lib/motion.ts they read, the
 * server's markup (always the final state: nothing hidden, nothing pinned past one screen), and the
 * stylesheet, which writes no motion number of its own.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { arrivalAtStart, ARRIVAL_SETTLE_MS, ARRIVAL_STYLE } from '../components/viewers/image/arrival';
import { playerModes, type ModeInput } from '../components/viewers/video/contract';
import { runChangeHidden, scrubOffset, scrubRunPx, scrubTime } from '../components/viewers/video/scrub';
import type { ResolvedMedia } from '../lib/media';
import { cssEasing, dur, ease, media, spring, toMs } from '../lib/motion';

// The components read the path through useMotionOk(); a public page.
vi.mock('next/navigation', () => ({ usePathname: () => '/projects/raven' }));

const read = (file: string) => fs.readFileSync(path.resolve(file), 'utf8');

describe('lib/motion.ts: the media numbers of sheet 6', () => {
  it('has the video, scrub, and gallery numbers the media read', () => {
    expect(media.video).toMatchObject({ inView: 0.6, posterOut: dur.quick, posterEase: ease.fade, preloadMargin: 200, shareStep: 0.1 });
    expect(media.scrub).toMatchObject({ pxPerSecond: 100, minScreens: 1, maxScreens: 3, spring: spring.scrub, endGuard: 0.05 });
    expect(media.gallery.lightboxIn).toEqual({ duration: dur.short, ease: ease.fade });
    expect(media.gallery.lightboxOut).toEqual({ duration: dur.quick, ease: ease.exit });
    expect(media.gallery.loadingLine).toMatchObject({ wait: 0.6, duration: dur.loading, width: 2 });
    expect(media.gallery.photoIn).toEqual({ duration: dur.short, ease: ease.fade });
    expect(media.gallery.wellOut).toEqual({ duration: dur.short, ease: ease.fade });
  });
});

describe("the player's own behavior (contract.ts, playerModes)", () => {
  const desk: ModeInput = {
    scrub: false,
    inLightbox: false,
    finePointer: true,
    motionOk: true,
    paused: false,
    slow: false,
    failed: false,
    released: false,
  };

  it('lets a video play by itself only with motion allowed, not paused, on a quick connection, and a file that loads', () => {
    expect(playerModes(desk).autoplay).toBe(true);
    expect(playerModes({ ...desk, finePointer: false }).autoplay).toBe(true);
    expect(playerModes({ ...desk, motionOk: false }).autoplay).toBe(false);
    expect(playerModes({ ...desk, paused: true }).autoplay).toBe(false);
    expect(playerModes({ ...desk, slow: true }).autoplay).toBe(false);
    // A failed file leaves the one-at-a-time rule, so the next video most in view takes its slot.
    expect(playerModes({ ...desk, failed: true }).autoplay).toBe(false);
  });

  it('keeps the run of a scrubbed video where the stylesheet does, and scrubs until play or failure', () => {
    const scrubbed = { ...desk, scrub: true };
    expect(playerModes(scrubbed)).toEqual({ scrubbable: true, runInUse: true, scrubbing: true, autoplay: false });
    expect(playerModes({ ...scrubbed, released: true })).toMatchObject({ runInUse: true, scrubbing: false, autoplay: false });
    expect(playerModes({ ...scrubbed, slow: true })).toMatchObject({ runInUse: true, scrubbing: false });
    expect(playerModes({ ...scrubbed, failed: true })).toMatchObject({ runInUse: true, scrubbing: false, autoplay: false });
    // Touch, reduced motion, the pause control: an ordinary player.
    expect(playerModes({ ...scrubbed, finePointer: false })).toMatchObject({ runInUse: false, scrubbing: false, autoplay: true });
    expect(playerModes({ ...scrubbed, motionOk: false })).toMatchObject({ runInUse: false, scrubbing: false, autoplay: false });
    expect(playerModes({ ...scrubbed, paused: true })).toMatchObject({ runInUse: false, scrubbing: false, autoplay: false });
    // In the lightbox the option means nothing.
    expect(playerModes({ ...scrubbed, inLightbox: true })).toEqual({ scrubbable: false, runInUse: false, scrubbing: false, autoplay: true });
  });
});

describe('the scroll-scrubbed video (sheet 6.2)', () => {
  it('runs 100 px of scroll a second of video, at least one screen and at most three', () => {
    // A 12 s clip in a 900 px window: 1,200 px.
    expect(scrubRunPx(12, 900)).toBe(1200);
    // A 4 s clip would want 400 px: one screen at least.
    expect(scrubRunPx(4, 900)).toBe(900);
    // A 60 s film would want 6,000 px: three screens at most.
    expect(scrubRunPx(60, 900)).toBe(2700);
    expect(scrubRunPx(12, 1440)).toBe(1440);
  });

  it('has no run while the length is unknown', () => {
    expect(scrubRunPx(0, 900)).toBe(0);
    expect(scrubRunPx(Number.NaN, 900)).toBe(0);
    expect(scrubRunPx(12, 0)).toBe(0);
  });

  it('changes the run only while what follows it stays below the window', () => {
    // The run ends 1,400 px down a 900 px window: growing it by 300 px moves nothing in view.
    expect(runChangeHidden(1400, 300, 900)).toBe(true);
    // Shrinking it by 400 px would lift what follows into view.
    expect(runChangeHidden(1100, -400, 900)).toBe(false);
    expect(runChangeHidden(1300, -400, 900)).toBe(true);
    // The run's end is in view (the reader is near the end of the pin, or past it).
    expect(runChangeHidden(600, 300, 900)).toBe(false);
  });

  it('measures progress from the pin under the nav to the end of the run', () => {
    expect(scrubOffset(64, 1200)).toEqual(['0px 64px', '1200px 64px']);
    expect(scrubOffset(88, 900)).toEqual(['0px 88px', '900px 88px']);
  });

  it('maps progress to the playhead, stopping short of the end so the last frame shows', () => {
    expect(scrubTime(0, 12)).toBe(0);
    expect(scrubTime(0.5, 12)).toBeCloseTo((12 - media.scrub.endGuard) / 2);
    expect(scrubTime(1, 12)).toBeCloseTo(12 - media.scrub.endGuard);
    expect(scrubTime(1.4, 12)).toBeCloseTo(12 - media.scrub.endGuard);
    expect(scrubTime(-0.2, 12)).toBe(0);
    expect(scrubTime(0.5, 0)).toBe(0);
  });
});

describe('a photo arriving (sheet 6.4 and 8.1)', () => {
  it('waits, hidden, only while nothing of the photo has arrived and motion is allowed', () => {
    expect(arrivalAtStart({ complete: false, naturalWidth: 0 }, true)).toBe('wait');
    // Already painted, or painting progressively: left as it is.
    expect(arrivalAtStart({ complete: true, naturalWidth: 1600 }, true)).toBe('idle');
    expect(arrivalAtStart({ complete: false, naturalWidth: 1600 }, true)).toBe('idle');
    // Failed (complete with no pixels): its own error state takes the well.
    expect(arrivalAtStart({ complete: true, naturalWidth: 0 }, true)).toBe('idle');
    // Reduced motion: the photo appears when it arrives, with no line and no fade.
    expect(arrivalAtStart({ complete: false, naturalWidth: 0 }, false)).toBe('idle');
    expect(arrivalAtStart(null, true)).toBe('idle');
  });

  it('fades the photo in, then the well out, by the numbers of lib/motion.ts', () => {
    expect(ARRIVAL_STYLE).toEqual({
      '--mm-photo-in': `${toMs(media.gallery.photoIn.duration)}ms`,
      '--mm-photo-ease': cssEasing(media.gallery.photoIn.ease),
      '--mm-well-out': `${toMs(media.gallery.wellOut.duration)}ms`,
      '--mm-well-ease': cssEasing(media.gallery.wellOut.ease),
    });
    // The well goes once both fades are over: 200 ms in, then 200 ms out.
    expect(ARRIVAL_SETTLE_MS).toBe(400);
  });
});

describe('the server markup is the final state', () => {
  const clip: ResolvedMedia = {
    kind: 'video',
    file: { src: '/dev/samples/clip.mp4', name: 'clip.mp4', ext: 'mp4', typeLabel: 'MP4 video', downloadHref: '/dev/samples/clip.mp4' },
    alt: '',
    poster: { src: '/dev/samples/clip-poster.webp', width: 1280, height: 720 },
    width: 1280,
    height: 720,
    store: 'repo',
  };
  const photo = (n: number): ResolvedMedia => ({
    kind: 'image',
    file: { src: `/dev/samples/photo-${n}.webp`, name: `photo-${n}.webp`, ext: 'webp', typeLabel: 'WebP image', downloadHref: `/dev/samples/photo-${n}.webp` },
    alt: '',
    width: 1600,
    height: 1000,
    store: 'repo',
  });

  it('paints a video poster in place, and a scrubbed video with one screen of run and no length of its own', async () => {
    const { default: VideoPlayer } = await import('../components/viewers/video/VideoPlayer');
    const plain = renderToString(createElement(VideoPlayer, { media: clip }));
    expect(plain).toContain('mm-poster');
    expect(plain).not.toContain('data-out');
    expect(plain).not.toContain('mm-scrub');
    expect(plain).toContain('--mm-poster-out:150ms');

    const scrubbed = renderToString(createElement(VideoPlayer, { media: clip, scrub: true }));
    expect(scrubbed).toContain('class="mm-scrub"');
    expect(scrubbed).toContain('class="mm-scrub__stage"');
    expect(scrubbed).toContain('class="mm-scrub__run"');
    expect(scrubbed).toContain('class="mm-scrub__end"');
    // The run's length is the stylesheet's own (one screen) until the browser knows the file's.
    expect(scrubbed).not.toContain('--scrub-run');

    // In the lightbox a scrub option means nothing: an ordinary player.
    const boxed = renderToString(createElement(VideoPlayer, { media: clip, scrub: true, inLightbox: true }));
    expect(boxed).not.toContain('mm-scrub');
  });

  it('paints every gallery photo as it is: no loading well and no hidden photo before scripts run', async () => {
    const { default: Gallery } = await import('../components/viewers/image/Gallery');
    const html = renderToString(createElement(Gallery, { items: [photo(1), photo(2)] }));
    expect(html).toContain('mm-photo');
    expect(html).not.toContain('data-arrive');
    expect(html).not.toContain('mm-load');
  });
});

describe('app/motion-media.css', () => {
  const css = read('app/motion-media.css');

  it('writes no duration or curve of its own: lib/motion.ts sets them as custom properties', () => {
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(rules).not.toMatch(/\d+(\.\d+)?m?s\b/);
    expect(rules).not.toMatch(/cubic-bezier/);
    for (const name of [
      '--mm-poster-out',
      '--mm-poster-ease',
      '--mm-lb-in',
      '--mm-lb-in-ease',
      '--mm-lb-out',
      '--mm-lb-out-ease',
      '--mm-photo-in',
      '--mm-photo-ease',
      '--mm-well-out',
      '--mm-well-ease',
    ]) {
      expect(rules).toContain(`var(${name})`);
    }
  });

  it('fades the loading well out only after the photo has faded in over it', () => {
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const well = /\.mm-load\[data-arrive='show'\] \{([\s\S]*?)\}/.exec(rules)?.[1] ?? '';
    expect(well).toContain('opacity: 0;');
    // Its delay is the photo's fade.
    expect(well).toContain('transition: opacity var(--mm-well-out) var(--mm-well-ease) var(--mm-photo-in);');
  });

  it('pins and runs the scrubbed video only on a fine pointer, with motion allowed and not paused', () => {
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const query = /@media \(hover: hover\) and \(pointer: fine\) and \(prefers-reduced-motion: no-preference\) \{([\s\S]*?)\n\}/.exec(rules);
    expect(query).not.toBeNull();
    const inside = query?.[1] ?? '';
    expect(inside).toContain(':root:not([data-motion-paused]) .mm-scrub__stage {');
    expect(inside).toContain('position: sticky;');
    expect(inside).toContain(':root:not([data-motion-paused]) .mm-scrub__run {');
    expect(inside).toContain('height: var(--scrub-run, 100vh);');
    // Nowhere else is the run kept or the stage pinned.
    const outside = rules.replace(query?.[0] ?? '', '');
    expect(outside).not.toContain('sticky');
    expect(outside).not.toContain('--scrub-run');
  });

  it('fits the whole pinned block between the pin and the window foot, outside full screen', () => {
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const query = /@media \(hover: hover\) and \(pointer: fine\) and \(prefers-reduced-motion: no-preference\) \{([\s\S]*?)\n\}/.exec(rules);
    const inside = query?.[1] ?? '';
    // The pin and the room under it read the same top.
    expect(rules).toMatch(/\.mm-scrub__stage \{\s*top: var\(--mm-scrub-top\);\s*\}/);
    const frame = /:root:not\(\[data-motion-paused\]\) \.mm-scrub__stage \.ar-mv:not\(\[data-fullscreen\]\) \{([\s\S]*?)\}/.exec(inside)?.[1] ?? '';
    expect(frame).toContain('max-height: calc(100vh - var(--mm-scrub-top) - var(--mm-scrub-foot));');
    // The well gives up the height; the bar and the caption keep theirs.
    const well = /\.ar-mv:not\(\[data-fullscreen\]\) > \.ar-mv__well \{([\s\S]*?)\}/.exec(inside)?.[1] ?? '';
    expect(well).toContain('min-height: 0;');
    // Never outside the scrub's own media query: an ordinary player keeps its ratio.
    const outside = rules.replace(query?.[0] ?? '', '');
    expect(outside).not.toContain('max-height');
  });

  it('is loaded once, by the root layout', () => {
    const imports = read('app/layout.tsx').match(/import '\.\/motion-media\.css';/g) ?? [];
    expect(imports).toHaveLength(1);
  });
});
