import fs from 'node:fs';
import path from 'node:path';
import { spring as motionSpring } from 'motion';
import type { Transition } from 'motion/react';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SKY,
  cards,
  cssEasing,
  delay,
  dur,
  ease,
  easeCss,
  hero,
  load,
  media,
  once,
  page,
  spring,
  springPhysics,
  toMs,
} from '../lib/motion';
import { isAdminPath, motionOk, subscribeMotionOk, useMotionOk } from '../lib/useMotionOk';

// Hoisted above the imports by Vitest: the hook reads the path the test sets.
const route = vi.hoisted(() => ({ pathname: '/' as string | null }));
vi.mock('next/navigation', () => ({ usePathname: () => route.pathname }));

const read = (file: string) => fs.readFileSync(path.resolve(file), 'utf8');

describe('lib/motion.ts holds the numbers of the motion sheets', () => {
  it('has the durations of sheet 1.2, in seconds', () => {
    expect(dur.press).toBe(0.12);
    expect(dur.base).toBe(0.3);
    expect(dur.sheet).toBe(0.32);
    expect(dur.sheetBack).toBe(0.24);
    expect(dur.line).toBe(0.4);
    expect(dur.fade).toBe(0.6);
    expect(dur.loading).toBe(1.4);
    expect(delay.lineStep).toBe(0.06);
    expect(delay.loadingWait).toBe(0.6);
    expect(toMs(dur.press)).toBe(120);
    expect(toMs(dur.scan)).toBe(560);
  });

  it('has the easings of sheet 1.3, as Motion arrays and as CSS', () => {
    expect(ease.settle).toEqual([0.2, 0.7, 0.2, 1]);
    expect(ease.exit).toEqual([0.4, 0, 1, 1]);
    expect(easeCss.settle).toBe('cubic-bezier(0.2, 0.7, 0.2, 1)');
    expect(easeCss.fade).toBe('cubic-bezier(0, 0, 0.58, 1)');
    expect(easeCss.linear).toBe('linear');
    expect(cssEasing([0.65, 0, 0.35, 1])).toBe(easeCss.move);
    // The stylesheet's --ease-out is the settle curve.
    const easeOut = /--ease-out:\s*([^;]+);/.exec(read('app/sheet.css'));
    if (easeOut) expect(easeOut[1].trim()).toBe(easeCss.settle);
  });

  it('has the springs of sheet 1.4, as Motion takes them', () => {
    expect(spring.lens).toEqual({ type: 'spring', visualDuration: 0.25, bounce: 0.15 });
    expect(spring.snap).toEqual({ type: 'spring', visualDuration: 0.4, bounce: 0 });
    // Type-checked by tsc: each value goes straight into a Motion transition.
    const transitions: Transition[] = [spring.lens, spring.rest, { duration: dur.base, ease: ease.settle }];
    expect(transitions).toHaveLength(3);
  });

  it("prints the same springs by stiffness and damping: Motion's own spring moves alike either way", () => {
    for (const name of Object.keys(spring) as (keyof typeof spring)[]) {
      const byTime = motionSpring({ keyframes: [0, 1], visualDuration: spring[name].visualDuration, bounce: spring[name].bounce });
      const byPhysics = motionSpring({ keyframes: [0, 1], ...springPhysics[name] });
      for (let t = 0; t <= 1500; t += 10) {
        expect(Math.abs(byTime.next(t).value - byPhysics.next(t).value)).toBeLessThan(0.003);
      }
    }
  });

  it('keeps the later sheets on the sheet 1 tokens', () => {
    expect(load.headline.duration).toBe(dur.line);
    expect(load.headline.step).toBe(delay.lineStep);
    expect(load.drawing).toEqual({ start: 0.2, duration: 0.9, ease: ease.settle });
    expect(load.lens.start).toBeCloseTo(delay.strokeStart + dur.stroke, 12);
    expect(load.end).toBe(1.6);
    expect(load.onceKey).toBe(once.intro);
    expect(hero.lens.follow).toBe(spring.lens);
    expect(hero.lens.back).toBe(spring.rest);
    expect(hero.rotor.cruise).toBe(82);
    expect(load.scan.width * hero.drawing.width).toBeCloseTo(132, 9);
    expect(cards.tilt.max).toBe(4);
    expect(media.gallery.glide).toEqual({ power: 0.8, timeConstant: 325 });
    expect(page.menu.close).toEqual({ duration: dur.sheetBack, ease: ease.exit });
    expect(page.ticker.loop).toBe(80);
  });

  it('has the sky numbers of sheet 3 and the Sky README', () => {
    expect(SKY.site).toEqual({ lat: 37.354, lon: -121.955 });
    expect(SKY.facing).toBe(45);
    expect(SKY.speed).toBe(20);
    expect(SKY.meteorEvery).toEqual([10, 20]);
    expect(SKY.meteor).toMatchObject({ travel: 260, tail: 90, duration: dur.meteor });
    expect(SKY.parallax).toMatchObject({ x: 12, y: 8, milkyWayX: 2, milkyWayY: 1.5, vanishingPoint: 40, smoothing: 0.12 });
    expect(SKY.drafting).toMatchObject({ rest: 0.35, near: 230, brightLimit: 2.6, maxStars: 4, box: 12, nameSize: 13 });
    expect(SKY.ripple).toMatchObject({ width: 0.7, aspect: 0.22, opacity: 0.8, duration: dur.ripple });
    expect(SKY.shimmer).toEqual({ limit: 2, depth: 0.08, period: 1.9 });
    expect(SKY.liveFade).toMatchObject({ notBefore: 0.4, duration: dur.fade });
    expect([SKY.demoteBelowFps, SKY.demoteAfter]).toEqual([45, 2]);
    expect(SKY.dpr).toEqual({ full: 2, light: 1.5 });
    expect([SKY.dawnMin, SKY.dawnMax, SKY.lightTierLimit, SKY.extinction]).toEqual([0.06, 0.32, 5.35, 0.25]);
    expect([SKY.idlePause, SKY.scrollTurn, SKY.scrollRows, SKY.rowPeriod]).toEqual([30, 4, 6, 5]);
  });

  it('agrees with the tokens the stylesheets already hold', () => {
    const tokens = read('app/tokens.css');
    const horizon = /--horizon:\s*([\d.]+)%;/.exec(tokens);
    if (horizon) expect(Number(horizon[1]) / 100).toBe(SKY.horizon);
    const dawnMax = /--dawn-max:\s*([\d.]+);/.exec(tokens);
    if (dawnMax) expect(Number(dawnMax[1])).toBe(SKY.dawnMax);
  });

  it('holds no color: no hex value and no color function', () => {
    const source = read('lib/motion.ts');
    expect(source).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(source).not.toMatch(/\b(rgba?|hsla?|oklch|color-mix)\(/i);
  });
});

describe('useMotionOk', () => {
  /** A browser window whose reduced-motion setting and path the test controls. */
  function fakeWindow(pathname: string) {
    const listeners = new Set<() => void>();
    const query = {
      matches: false,
      addEventListener: (_type: string, listener: () => void) => void listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => void listeners.delete(listener),
    };
    const asked: string[] = [];
    const win = {
      location: { pathname },
      matchMedia: (media: string) => {
        asked.push(media);
        return query;
      },
    };
    const fire = () => listeners.forEach((listener) => listener());
    return { win, query, asked, listeners, fire };
  }

  function Probe() {
    return createElement('span', null, String(useMotionOk()));
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    route.pathname = '/';
  });

  it('answers true in the server render of a public page and false under /admin', () => {
    route.pathname = '/';
    expect(renderToString(createElement(Probe))).toBe('<span>true</span>');
    route.pathname = '/projects/raven';
    expect(renderToString(createElement(Probe))).toBe('<span>true</span>');
    route.pathname = '/admin';
    expect(renderToString(createElement(Probe))).toBe('<span>false</span>');
    route.pathname = '/admin/projects';
    expect(renderToString(createElement(Probe))).toBe('<span>false</span>');
  });

  it('knows /admin by its path segment', () => {
    expect(isAdminPath('/admin')).toBe(true);
    expect(isAdminPath('/admin/')).toBe(true);
    expect(isAdminPath('/admin/settings')).toBe(true);
    expect(isAdminPath('/')).toBe(false);
    expect(isAdminPath('/administrator')).toBe(false);
    expect(isAdminPath('/projects/admin')).toBe(false);
    expect(isAdminPath(null)).toBe(false);
  });

  it('answers false outside a browser', () => {
    expect(motionOk()).toBe(false);
    expect(subscribeMotionOk(() => {})).toBeTypeOf('function');
  });

  it('reads the reduced-motion setting live, and follows a change during the visit', () => {
    const { win, query, asked, listeners, fire } = fakeWindow('/');
    vi.stubGlobal('window', win);
    expect(motionOk()).toBe(true);
    expect(asked).toEqual(['(prefers-reduced-motion: reduce)']);

    let calls = 0;
    const stop = subscribeMotionOk(() => {
      calls += 1;
    });
    query.matches = true;
    fire();
    expect(calls).toBe(1);
    expect(motionOk()).toBe(false);

    query.matches = false;
    fire();
    expect(calls).toBe(2);
    expect(motionOk()).toBe(true);

    stop();
    expect(listeners.size).toBe(0);
  });

  it('answers false on /admin in a browser', () => {
    const { win } = fakeWindow('/admin/projects');
    vi.stubGlobal('window', win);
    expect(motionOk()).toBe(false);
  });
});
