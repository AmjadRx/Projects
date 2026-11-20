import { cubicBezier } from 'motion';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  calloutTimeline,
  cardsForDomain,
  coverTransitionName,
  inViewThresholds,
  isPlainClick,
  mirrorEase,
  mostlyOnScreen,
  pickRunner,
  swingAngle,
  swingTimeAt,
  tiltToward,
} from '../lib/cardMotion';
import { cards, ease, page, type Bezier } from '../lib/motion';
import { UI } from '../lib/strings';
import type { ResolvedMedia } from '../lib/media';
import CardShell from '../components/sheet/CardShell';
import DimensionCallouts from '../components/sheet/DimensionCallouts';
import { plateStyle, slotGeometry } from '../components/sheet/callouts';
import { joinCoverRun } from '../components/sheet/coverRun';
import { domainFilter, domainKeys, domainOptions } from '../components/sheet/DomainFilter';
import ProjectExplorer from '../components/sheet/ProjectExplorer';

// The client components read the route (useMotionOk) and the router (CardShell).
vi.mock('next/navigation', () => ({ usePathname: () => '/projects', useRouter: () => ({ push: () => undefined }) }));

const box = { left: 100, top: 50, width: 400, height: 300 };

describe('the card tilt (motion sheet 5.2)', () => {
  it('turns toward the pointer, up to the maximum at the edges', () => {
    const max = cards.tilt.max;
    const centre = tiltToward(300, 200, box, max);
    expect(centre.rotateX).toBeCloseTo(0, 12);
    expect(centre.rotateY).toBeCloseTo(0, 12);
    expect([centre.fx, centre.fy]).toEqual([0.5, 0.5]);

    // Top right: the top and the right edge turn toward the pointer (the bundle's ProjectCard).
    expect(tiltToward(500, 50, box, max)).toMatchObject({ rotateX: max, rotateY: max, fx: 1, fy: 0 });
    // Bottom left: the other way.
    expect(tiltToward(100, 350, box, max)).toMatchObject({ rotateX: -max, rotateY: -max, fx: 0, fy: 1 });
    // A quarter of the way across and down: half the angle.
    const quarter = tiltToward(200, 125, box, max);
    expect(quarter.rotateY).toBeCloseTo(-max / 2, 12);
    expect(quarter.rotateX).toBeCloseTo(max / 2, 12);
  });

  it('never passes the maximum, even for a pointer outside the card', () => {
    const far = tiltToward(-1000, 5000, box, cards.tilt.max);
    expect(far.rotateX).toBe(-cards.tilt.max);
    expect(far.rotateY).toBe(-cards.tilt.max);
    expect(tiltToward(300, 200, { left: 0, top: 0, width: 0, height: 0 }, cards.tilt.max)).toMatchObject({ rotateX: 0, rotateY: 0 });
  });

  it('tilts the featured card half as far', () => {
    expect(cards.tilt).toMatchObject({ max: 4, featured: 2, perspective: 1000 });
    expect(tiltToward(500, 50, box, cards.tilt.featured)).toMatchObject({ rotateX: 2, rotateY: 2 });
  });
});

describe('the callouts timeline (motion sheet 5.3)', () => {
  const timeline = calloutTimeline(cards.callouts);

  it('draws the lines, then the plates from 80 ms and the arrowheads from 120 ms', () => {
    expect(timeline.total).toBe(0.24);
    expect(timeline.draw.lines).toEqual({ delay: 0, duration: 0.2, ease: ease.settle });
    expect(timeline.draw.plates).toEqual({ delay: 0.08, duration: 0.15, ease: ease.fade });
    expect(timeline.draw.arrowheads).toEqual({ delay: 0.12, duration: 0.12, ease: ease.fade });
  });

  it('undraws in reverse: what finished last leaves first, on the mirrored curve', () => {
    expect(timeline.undraw.arrowheads.delay).toBe(0);
    expect(timeline.undraw.plates.delay).toBe(0.01);
    expect(timeline.undraw.lines.delay).toBe(0.04);
    for (const part of ['lines', 'arrowheads', 'plates'] as const) {
      const { draw, undraw } = { draw: timeline.draw[part], undraw: timeline.undraw[part] };
      expect(draw.delay + draw.duration + undraw.delay).toBeCloseTo(timeline.total, 9);
      expect(undraw.duration).toBe(draw.duration);
      expect(undraw.ease).toEqual(mirrorEase(draw.ease));
    }
  });

  it("retraces the draw exactly: undrawn at time t equals drawn at the total less t", () => {
    const progress = (t: number, delay: number, duration: number) => Math.min(1, Math.max(0, (t - delay) / duration));
    for (const part of ['lines', 'arrowheads', 'plates'] as const) {
      const draw = timeline.draw[part];
      const undraw = timeline.undraw[part];
      const forward = cubicBezier(...(draw.ease as [number, number, number, number]));
      const backward = cubicBezier(...(undraw.ease as [number, number, number, number]));
      for (let t = 0; t <= timeline.total; t += 0.005) {
        const drawn = forward(progress(timeline.total - t, draw.delay, draw.duration));
        const undrawn = 1 - backward(progress(t, undraw.delay, undraw.duration));
        expect(Math.abs(drawn - undrawn), `${part} at ${t.toFixed(3)} s`).toBeLessThan(0.002);
      }
    }
  });

  it('mirrors a curve, and mirroring twice gives it back', () => {
    expect(mirrorEase(ease.settle)).toEqual([0.8, 0, 0.8, 0.3]);
    expect(mirrorEase(ease.fade)).toEqual([0.42, 0, 1, 1]);
    expect(mirrorEase(ease.linear)).toEqual([0, 0, 1, 1]);
    for (const curve of Object.values(ease) as Bezier[]) expect(mirrorEase(mirrorEase(curve))).toEqual([...curve]);
  });

  it('keeps every plate inside its well, sliding along its line on a narrow card', () => {
    const [top, side, bottom] = slotGeometry(290, 181);
    const topCentre = Math.round((top.kind === 'h' ? top.x1 + top.x2 : 0) / 2);
    const topStyle = plateStyle(top, 290);
    expect(topStyle.left).toBe(`${topCentre}px`);
    expect(topStyle.transform).toBe(`translate(clamp(${8 - topCentre}px, -50%, calc(${290 - 8 - topCentre}px - 100%)), -50%)`);
    expect(plateStyle(bottom, 290).transform).toMatch(/^translate\(clamp\(.+\), calc\(-100% - 8px\)\)$/);
    const anchor = side.kind === 'v' ? side.x - 14 : 0;
    expect(plateStyle(side, 290)).toEqual({
      left: `${anchor}px`,
      top: `${side.kind === 'v' ? Math.round((side.y1 + side.y2) / 2) : 0}px`,
      transform: `translate(max(-100%, ${8 - anchor}px), -50%)`,
    });
  });

  it('times the project page lines as sheet 7.3 does', () => {
    expect(page.cardToPage.callouts.duration).toBe(cards.callouts.lines.duration);
    expect(page.cardToPage.callouts.ease).toBe(cards.callouts.lines.ease);
  });
});

describe("a card's callouts on a phone (DESIGN_DIRECTION.md 5.2 and 7)", () => {
  const callouts = [
    { label: 'Span', value: '1.34 m' },
    { label: 'Pack', value: '504 V max' },
    { label: 'Sensors', value: '140+ thermistors' },
  ];
  const photo: ResolvedMedia = {
    kind: 'image',
    file: { src: '/media/raven/cover.webp', name: 'cover.webp', ext: 'webp', typeLabel: 'WebP image', downloadHref: '' },
    alt: 'Raven on the stand',
    store: 'repo',
  };

  it("serves a photo card's row of readouts for the stylesheet to show under 768 px, nothing drawn yet", () => {
    const html = renderToString(createElement(DimensionCallouts, { media: photo, callouts, layout: 'over', retry: false, sizes: '100vw' }));
    expect(html).toContain('ar-dim ar-dim--over');
    expect(html).toMatch(/<ul class="ar-dim__row" aria-label="[^"]+">/);
    for (const c of callouts) expect(html).toContain(c.value);
    // The lines are drawn in the browser, once the well has been measured: none on the server.
    expect(html).not.toContain('ar-dim__svg');
  });

  it('gives a card with no photo no callouts at all', () => {
    const html = renderToString(createElement(DimensionCallouts, { media: null, callouts, layout: 'over', sizes: '100vw' }));
    expect(html).toContain('ar-dim--nophoto');
    expect(html).not.toContain('ar-dim__row');
  });
});

describe('the model cover swing (motion sheet 5.2)', () => {
  const { swing, cycle } = cards.model;

  it('turns 28 degrees either way on a 6 s sine, from rest', () => {
    expect([swing, cycle]).toEqual([28, 6]);
    expect(swingAngle(0, swing, cycle)).toBeCloseTo(0, 12);
    expect(swingAngle(1.5, swing, cycle)).toBeCloseTo(28, 12);
    expect(swingAngle(3, swing, cycle)).toBeCloseTo(0, 12);
    expect(swingAngle(4.5, swing, cycle)).toBeCloseTo(-28, 12);
    expect(swingAngle(6, swing, cycle)).toBeCloseTo(0, 9);
    for (let t = 0; t < 12; t += 0.1) expect(Math.abs(swingAngle(t, swing, cycle))).toBeLessThanOrEqual(swing + 1e-9);
  });

  it('carries on from where a cover rests instead of jumping', () => {
    for (let angle = -28; angle <= 28; angle += 3.5) {
      expect(swingAngle(swingTimeAt(angle, swing, cycle), swing, cycle)).toBeCloseTo(angle, 9);
    }
    expect(swingTimeAt(0, swing, cycle)).toBe(0);
    expect(swingTimeAt(40, swing, cycle)).toBeCloseTo(cycle / 4, 12);
    expect(swingTimeAt(5, 0, cycle)).toBe(0);
  });
});

describe('which cover runs on a phone (motion sheet 5.2, Phones)', () => {
  it('reports the share in view in even steps from 0.6 to 1, and when a card is gone', () => {
    const thresholds = inViewThresholds(cards.phoneInView, cards.phoneInViewSteps);
    expect(thresholds[0]).toBe(0);
    expect(thresholds[1]).toBe(0.6);
    expect(thresholds[thresholds.length - 1]).toBe(1);
    expect(thresholds).toHaveLength(cards.phoneInViewSteps + 2);
    expect([...thresholds].sort((a, b) => a - b)).toEqual(thresholds);
  });

  it('picks the cover most in view, at 0.6 or more, and keeps the one running on a tie', () => {
    const t = cards.phoneInView;
    expect(pickRunner(new Map(), t, null)).toBeNull();
    expect(pickRunner(new Map([['a', 0.59], ['b', 0.2]]), t, null)).toBeNull();
    expect(pickRunner(new Map([['a', 0.6]]), t, null)).toBe('a');
    expect(pickRunner(new Map([['a', 0.7], ['b', 0.9]]), t, 'a')).toBe('b');
    expect(pickRunner(new Map([['a', 0.8], ['b', 0.8]]), t, 'b')).toBe('b');
    expect(pickRunner(new Map([['a', 0.8], ['b', 0.8]]), t, null)).toBe('a');
  });

  it('starts and stops covers one at a time as their cards move through the view', () => {
    const log: string[] = [];
    const a = joinCoverRun('a', (on) => log.push(`a ${on}`));
    const b = joinCoverRun('b', (on) => log.push(`b ${on}`));
    a.report(0.65);
    expect(log).toEqual(['a true']);
    b.report(0.9);
    expect(log).toEqual(['a true', 'a false', 'b true']);
    b.report(0.3);
    expect(log).toEqual(['a true', 'a false', 'b true', 'b false', 'a true']);
    a.leave();
    expect(log.slice(-1)).toEqual(['a false']);
    b.report(0.7);
    expect(log.slice(-1)).toEqual(['b true']);
    b.leave();
    expect(log.slice(-1)).toEqual(['b false']);
  });
});

describe('opening a project (motion sheet 7.3)', () => {
  it('names the shared cover per project, as a valid CSS identifier', () => {
    expect(coverTransitionName('raven')).toBe('cover-raven');
    expect(coverTransitionName('fsae-bronco-racing')).toBe('cover-fsae-bronco-racing');
    expect(coverTransitionName('3d-printer')).toBe('cover-3d-printer');
    expect(coverTransitionName('Odd slug!')).toBe('cover-odd-slug-');
    expect(new Set(['raven', 'moonlamp', 'palmsync'].map(coverTransitionName)).size).toBe(3);
  });

  it('takes over only a plain primary click', () => {
    const plain = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false };
    expect(isPlainClick(plain)).toBe(true);
    expect(isPlainClick({ ...plain, metaKey: true })).toBe(false);
    expect(isPlainClick({ ...plain, ctrlKey: true })).toBe(false);
    expect(isPlainClick({ ...plain, shiftKey: true })).toBe(false);
    expect(isPlainClick({ ...plain, altKey: true })).toBe(false);
    expect(isPlainClick({ ...plain, button: 1 })).toBe(false);
    expect(isPlainClick({ ...plain, defaultPrevented: true })).toBe(false);
  });

  it('carries the cover back only into a card that is mostly on screen', () => {
    expect(mostlyOnScreen({ left: 10, top: 10, width: 300, height: 200 }, 1440, 900)).toBe(true);
    expect(mostlyOnScreen({ left: 10, top: 800, width: 300, height: 200 }, 1440, 900)).toBe(true);
    expect(mostlyOnScreen({ left: 10, top: 801, width: 300, height: 200 }, 1440, 900)).toBe(false);
    expect(mostlyOnScreen({ left: 10, top: -150, width: 300, height: 200 }, 1440, 900)).toBe(false);
    expect(mostlyOnScreen({ left: 1300, top: 10, width: 300, height: 200 }, 1440, 900)).toBe(false);
    expect(mostlyOnScreen({ left: 10, top: 10, width: 0, height: 200 }, 1440, 900)).toBe(false);
  });

  it('holds a click for less than the browser allows an update and longer than the cover travels', () => {
    expect(page.cardToPage.cover).toEqual({ duration: 0.25, ease: ease.move });
    expect(page.cardToPage.crossFade).toEqual({ duration: 0.25, ease: ease.fade });
    expect(page.cardToPage.wait).toBeGreaterThan(page.cardToPage.cover.duration);
    expect(page.cardToPage.wait).toBeLessThan(4);
  });
});

describe('the domain filter (motion sheet 7.4)', () => {
  const projects = [
    { slug: 'a', domain: 'Embedded, tooling' },
    { slug: 'b', domain: 'eVTOL, embedded' },
    { slug: 'c', domain: 'Digital design' },
  ];

  it('shows every card for All, and the cards of a domain in their order', () => {
    const items = projects.map((p) => ({ slug: p.slug, domains: domainKeys(p) }));
    expect(cardsForDomain(items, '').map((i) => i.slug)).toEqual(['a', 'b', 'c']);
    expect(cardsForDomain(items, 'embedded').map((i) => i.slug)).toEqual(['a', 'b']);
    expect(cardsForDomain(items, 'nothing')).toEqual([]);
  });

  it("builds the filter's words on the server", () => {
    const filter = domainFilter(projects);
    expect(filter.label).toBe(UI.projects.filterLabel);
    expect(filter.all).toEqual({ label: UI.projects.filterAll, count: 3, result: UI.projects.showing(3, 3) });
    expect(filter.options[0]).toEqual({ key: 'embedded', label: 'Embedded', count: 2, result: UI.projects.showing(2, 3) });
    expect(filter.options.map((o) => o.key)).toEqual(domainOptions(projects).map((o) => o.key));
    expect(domainKeys({ domain: 'Embedded, embedded, EMBEDDED' })).toEqual(['embedded']);
  });

  it('serves every card in its final state, with the filter on All (no hidden start state)', () => {
    const html = renderToString(
      createElement(ProjectExplorer, {
        gridId: 'project-grid',
        filter: domainFilter(projects),
        items: projects.map((p) => ({ slug: p.slug, domains: domainKeys(p), card: createElement('article', null, `card ${p.slug}`) })),
      }),
    );
    for (const p of projects) expect(html).toContain(`card ${p.slug}`);
    expect(html).not.toMatch(/opacity:\s*0/);
    expect(html).toContain('id="project-grid"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain(UI.projects.showing(3, 3));
  });
});

describe('the card shell', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('serves the card at rest: no transform, the rim unlit, the children as they are', () => {
    const props = { variant: 'regular', slug: 'raven', domains: 'evtol power' } as Parameters<typeof CardShell>[0];
    const html = renderToString(createElement(CardShell, props, createElement('p', null, 'inside')));
    expect(html).toContain('class="ar-card ar-card--regular"');
    expect(html).toContain('data-domains="evtol power"');
    expect(html).toContain('<p>inside</p>');
    expect(html).toMatch(/transform:\s*none/);
    expect(html).toMatch(/class="ar-card__rim"[^>]*style="opacity:\s*0/);
    expect(html).not.toContain('rotateX');
  });
});
