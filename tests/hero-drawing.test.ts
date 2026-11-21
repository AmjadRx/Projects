import fs from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import HeroDrawing from '../components/home/hero/HeroDrawing';
import {
  CABLES,
  POD,
  ROTOR,
  VIEW,
  bandWidth,
  bladePath,
  clampToFrame,
  lensTicks,
  podCaps,
  rotorPose,
  toDrawing,
} from '../components/home/hero/raven';
import { lensTransform } from '../components/home/hero/lens';
import { introGoScript } from '../lib/intro';
import { hero, load } from '../lib/motion';
import { UI } from '../lib/strings';

// useMotionOk reads the path; the drawing renders on a public page.
vi.mock('next/navigation', () => ({ usePathname: () => '/' }));

const read = (file: string) => fs.readFileSync(path.resolve(file), 'utf8');

/** Applies an SVG matrix(a b c d e f) string to a point. */
function apply(matrix: string, x: number, y: number): [number, number] {
  const m = /^matrix\(([^)]+)\)$/.exec(matrix);
  if (!m) throw new Error(`not a matrix: ${matrix}`);
  const [a, b, c, d, e, f] = m[1].split(' ').map(Number);
  return [a * x + c * y + e, b * x + d * y + f];
}

function translateY(transform: string): number {
  const m = /^translate\(0 (-?[\d.]+)\)$/.exec(transform);
  if (!m) throw new Error(`not a vertical translate: ${transform}`);
  return Number(m[1]);
}

describe('the rotor pose (motion sheet 4.3; the Cruise board)', () => {
  it('is the drawing as drawn at hover', () => {
    const pose = rotorPose(hero.rotor.hover);
    expect(pose.progress).toBe(0);
    expect(translateY(pose.rotor)).toBe(0);
    expect(apply(pose.disc, 150, 54)).toEqual([150, 54]);
    expect(translateY(pose.podFront)).toBe(0);
    expect(apply(pose.podSides, 141, POD.front)).toEqual([141, POD.front]);
    expect(apply(pose.cableLeft, CABLES.left.x2, CABLES.left.y2)).toEqual([CABLES.left.x2, CABLES.left.y2]);
    expect([pose.blades, pose.tail, pose.tailHeat]).toEqual([1, 1, 1]);
  });

  it('matches the board at cruise: the disc folds to cos 82, the nacelle moves 26 forward, the pod grows 30', () => {
    const pose = rotorPose(hero.rotor.cruise);
    expect(pose.progress).toBe(1);
    expect(translateY(pose.rotor)).toBe(-26);
    // The board: disc centre 128 - 26 t, minor radius 74 cos(82 t degrees).
    const fold = Math.cos((82 * Math.PI) / 180);
    const [, centre] = apply(pose.disc, 150, ROTOR.cy);
    const [, top] = apply(pose.disc, 150, ROTOR.cy - ROTOR.discR);
    expect(centre).toBeCloseTo(102, 3);
    expect(centre - top).toBeCloseTo(74 * fold, 2);
    // The board's pod: top at 118 - 30 t, bottom fixed at 138, radius 9 (caps at 127 - 30 t and 129).
    expect(translateY(pose.podFront)).toBe(-30);
    expect(apply(pose.podSides, 141, POD.front)[1]).toBeCloseTo(POD.front - 30, 6);
    expect(apply(pose.podSides, 141, POD.back)[1]).toBeCloseTo(POD.back, 6);
    // The power runs keep their battery end and follow the hub: the board's discCy + 6.
    expect(apply(pose.cableLeft, CABLES.left.x1, CABLES.left.y1)).toEqual([CABLES.left.x1, CABLES.left.y1]);
    expect(apply(pose.cableLeft, CABLES.left.x2, CABLES.left.y2)[1]).toBeCloseTo(CABLES.left.y2 - 26, 3);
    expect(apply(pose.cableRight, CABLES.right.x1, CABLES.right.y1)[1]).toBeCloseTo(CABLES.right.y1, 3);
    expect(apply(pose.cableRight, CABLES.right.x2, CABLES.right.y2)[1]).toBeCloseTo(CABLES.right.y2 - 26, 3);
    // The board's opacities at cruise: blades 0.9 (1 - t), tail 0.75 (1 - 0.6 t), tail heat 1 - 0.55 t.
    expect([pose.blades, pose.tail, pose.tailHeat]).toEqual([0, 0.4, 0.45]);
  });

  it('is linear in the angle between, and clamped outside', () => {
    const half = rotorPose(41);
    expect(half.progress).toBeCloseTo(0.5, 12);
    expect(translateY(half.rotor)).toBe(-13);
    expect(apply(half.disc, 150, ROTOR.cy)[1]).toBeCloseTo(115, 3);
    expect(half.tail).toBe(0.7);
    expect(rotorPose(-20)).toEqual(rotorPose(hero.rotor.hover));
    expect(rotorPose(140)).toEqual(rotorPose(hero.rotor.cruise));
    expect(rotorPose(Number.NaN)).toEqual(rotorPose(hero.rotor.hover));
  });

  it('never writes -0 or long decimals into an attribute', () => {
    for (const angle of [0, 13.7, 41, 82]) {
      const pose = rotorPose(angle);
      for (const value of [pose.rotor, pose.disc, pose.podFront, pose.podSides, pose.cableLeft, pose.cableRight]) {
        expect(value).not.toMatch(/-0(?![.\d])/);
        expect(value).not.toMatch(/\d\.\d{7,}/);
      }
      for (const value of [pose.blades, pose.tail, pose.tailHeat]) expect(String(value)).not.toMatch(/\d\.\d{5,}/);
    }
  });
});

describe('the drawing geometry (the Hero boards)', () => {
  it('draws each wing blade as the board does', () => {
    expect(bladePath(150)).toBe('M84.2,104.1 L215.8,151.9');
    expect(bladePath(450)).toBe('M384.2,104.1 L515.8,151.9');
  });

  it('draws the pod as a capsule 18 wide, 20 long at hover (the board: y 118 to 138, rx 9)', () => {
    const caps = podCaps(150);
    expect(caps.front).toBe('M141,127 A9,9 0 0 1 159,127');
    expect(caps.back).toBe('M159,129 A9,9 0 0 1 141,129');
    expect(caps.sides).toBe('M141,127 V129 M159,127 V129');
    expect(POD.front - POD.halfWidth).toBe(118);
    expect(POD.back + POD.halfWidth).toBe(138);
  });

  it('puts four ticks just outside the lens ring', () => {
    expect(lensTicks(128)).toBe('M0,-132 V-142 M132,0 H142 M0,132 V142 M-132,0 H-142');
  });

  it('sizes the scan band at 22% of the drawing (132 units)', () => {
    expect(bandWidth(VIEW.width, load.scan.width)).toBe(132);
  });
});

describe('the lens follows a pointer in drawing units', () => {
  const box = { left: 840, top: 225, width: 552, height: 515.2 };

  it('maps the page to the drawing', () => {
    expect(toDrawing(840, 225, box)).toEqual({ x: 0, y: 0 });
    const far = toDrawing(840 + 552, 225 + 515.2, box);
    expect(far.x).toBeCloseTo(600, 9);
    expect(far.y).toBeCloseTo(560, 9);
    expect(toDrawing(10, 10, { left: 0, top: 0, width: 0, height: 0 })).toEqual(hero.lens.rest);
  });

  it('keeps its centre inside the inner frame (40 to 560 across, 40 to 520 down)', () => {
    expect(clampToFrame({ x: -50, y: 700 })).toEqual({ x: 40, y: 520 });
    expect(clampToFrame({ x: 600, y: 0 })).toEqual({ x: 560, y: 40 });
    expect(clampToFrame(hero.lens.rest)).toEqual(hero.lens.rest);
  });

  it('writes its place as one translate, to two decimals', () => {
    expect(lensTransform({ x: 152.19234, y: 134.256 })).toBe('translate(152.19 134.26)');
    expect(lensTransform(hero.lens.rest)).toBe('translate(300 196)');
  });
});

describe('the drawing as the server sends it', () => {
  const html = renderToString(createElement(HeroDrawing));
  const svg = html.slice(html.indexOf('<svg'), html.indexOf('</svg>') + 6);

  it("puts the load sequence's go after the svg and the caption, as the figure's last child", () => {
    // The go reads the drawing's animations, which lays the page out and may let a frame paint
    // before the parser goes on: the caption is parsed by then, so the figure never grows later.
    const go = `<script>${introGoScript()}</script>`;
    expect(html).toContain(`<div class="hm-art"><svg class="hd-svg"`);
    expect(html).toContain(`</svg></div><figcaption class="hm-art__cap">`);
    expect(html.endsWith(`</figcaption>${go}</figure>`)).toBe(true);
  });

  it('is a figure with the fixed caption, and an image whose label is the text alternative', () => {
    expect(html.startsWith('<figure class="hm-hero__art hm-hero__art--drawing"')).toBe(true);
    expect(html).toContain(`<figcaption class="hm-art__cap">${UI.heroCaption}</figcaption>`);
    expect(UI.heroCaption).toBe('Raven, tri-tiltrotor eVTOL. Illustration, not measured data.');
    expect(svg).toMatch(/<svg[^>]*role="img"/);
    expect(svg).toContain(`aria-label="${UI.hero.drawing}"`);
  });

  it('hides the thermal layer, the lens, the band and the split line from assistive technology', () => {
    for (const cls of ['hd-th', 'hd-ring', 'hd-split']) {
      expect(svg).toMatch(new RegExp(`class="${cls}"[^>]*aria-hidden="true"`));
    }
    expect(svg).toMatch(/clip-path="url\(#hd-box-clip\)" aria-hidden="true"><g class="hd-scan">/);
  });

  it('prints no text and no number anywhere a visitor could read it', () => {
    const text = svg.replace(/<[^>]*>/g, '');
    expect(text).toBe('');
    expect(UI.hero.drawing).not.toMatch(/\d/);
    expect(UI.heroCaption).not.toMatch(/\d/);
  });

  it('gives every solid stroke pathLength 1 for the stroke-in, and none to a dashed line', () => {
    const drawn = [...svg.matchAll(/<(\w+)\b[^>]*class="[^"]*\bhd-draw\b[^"]*"[^>]*>/g)];
    expect(drawn.length).toBe(28);
    for (const [tag] of drawn) expect(tag).toContain('pathLength="1"');
    const dashed = [...svg.matchAll(/<\w+\b[^>]*class="[^"]*hm-ln--(axis|disc)\b[^"]*"[^>]*>/g)];
    expect(dashed.length).toBe(4);
    for (const [tag] of dashed) expect(tag).not.toContain('pathLength');
  });

  it('names every part the tilt and the lens move, in both layers', () => {
    const count = (name: string) => (svg.match(new RegExp(`data-hd="${name}"`, 'g')) ?? []).length;
    expect({
      rotor: count('rotor'),
      disc: count('disc'),
      podFront: count('pod-front'),
      podSides: count('pod-sides'),
      cableLeft: count('cable-left'),
      cableRight: count('cable-right'),
      blade: count('blade'),
      tail: count('tail'),
      tailHeat: count('tail-heat'),
      lens: count('lens'),
    }).toEqual({ rotor: 4, disc: 6, podFront: 2, podSides: 2, cableLeft: 1, cableRight: 1, blade: 2, tail: 2, tailHeat: 2, lens: 2 });
  });

  it('rests the lens over the battery bay', () => {
    const lens = [...svg.matchAll(/<[^>]*data-hd="lens"[^>]*>/g)].map(([tag]) => /transform="([^"]+)"/.exec(tag)?.[1]);
    expect(lens).toEqual(['translate(300 196)', 'translate(300 196)']);
  });

  it('refers only to ids it defines', () => {
    const ids = new Set([...svg.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
    const refs = [...svg.matchAll(/url\(#([^)]+)\)|href="#([^"]+)"/g)].map((m) => m[1] ?? m[2]);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) expect(ids.has(ref), ref).toBe(true);
    // The stylesheet's mask reference too.
    expect(ids.has('hd-reveal')).toBe(true);
  });

  it('carries no color: the ramp comes from the stylesheet by class', () => {
    expect(html).not.toMatch(/#[0-9a-f]{3,8}\b(?![\w-])/i);
    expect(html).not.toMatch(/\b(rgba?|hsla?)\(/);
  });

  it("gives the stylesheet every number it reads, from lib/motion.ts", () => {
    const css = read('app/motion-drawing.css');
    const used = new Set([...css.matchAll(/var\((--hd-[\w-]+)/g)].map((m) => m[1]));
    used.delete('--hd-u');
    const style = /<figure[^>]*style="([^"]*)"/.exec(html)?.[1] ?? '';
    for (const name of used) expect(style, name).toContain(`${name}:`);
    expect(style).toContain('--hd-w:600');
    expect(style).toContain('--hd-h:560');
    expect(style).toContain('--hd-draw-delay:200ms');
    expect(style).toContain('--hd-draw-dur:900ms');
    expect(style).toContain('--hd-lens-delay:1100ms');
    expect(style).toContain('--hd-scan-delay:1000ms');
    expect(style).toContain('--hd-scan-dur:560ms');
    expect(style).toContain('--hd-scan-from:-132px');
    expect(style).toContain('--hd-split-line:1px');
  });
});

describe('app/motion-drawing.css', () => {
  const css = read('app/motion-drawing.css');

  it('holds no hex color (tokens only)', () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it('uses the thermal ramp only for the thermal view (DESIGN_DIRECTION.md 2.4, place 1)', () => {
    const rules = css.split('}').filter((rule) => /var\(--t[0-6]\)/.test(rule));
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) expect(rule.trim()).toMatch(/^(\/\*[\s\S]*?\*\/\s*)*\.hm-(th-[a-z]+|s[0-6])\s*\{/);
  });

  it('reads the fine-pointer query that DrawingStage uses', async () => {
    const { FINE_POINTER } = await import('../components/home/hero/hooks');
    expect(css).toContain(`@media ${FINE_POINTER}`);
  });

  /** The declarations of the first rule whose selector is exactly `selector`. */
  const rule = (selector: string) => {
    const at = css.indexOf(`${selector} {`);
    expect(at, selector).toBeGreaterThanOrEqual(0);
    return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
  };

  it('leaves vertical scrolling and pinch zoom to the browser on the drawing', () => {
    expect(rule('.hm-art')).toMatch(/touch-action:\s*pan-y pinch-zoom;/);
  });

  it('caps the drawing and its caption at 78 percent of the window height, as the media visual, at its own ratio', () => {
    expect(rule('.hm-hero__art--drawing')).toMatch(/grid-template-columns:\s*min\(100%, calc\(78vh \* var\(--hd-w\) \/ var\(--hd-h\)\)\);/);
    expect(rule('.hm-art')).toMatch(/width:\s*100%;/);
  });

  it('starts every step of the load sequence from data-intro-go, and only while motion is allowed', () => {
    const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const steps = [...bare.matchAll(/([^{}]+)\{[^{}]*animation:\s*hd-/g)].map((m) => m[1].trim());
    expect(steps.length).toBeGreaterThanOrEqual(4);
    for (const selectors of steps) {
      for (const selector of selectors.split(',')) {
        expect(selector.trim()).toMatch(/^:root:not\(\[data-motion-paused\]\) \.hm-hero\[data-intro\]\[data-intro-go\] /);
      }
    }
    const start = css.indexOf('@media (prefers-reduced-motion: no-preference)');
    expect(start).toBeGreaterThan(-1);
    expect(css.indexOf('animation: hd-')).toBeGreaterThan(start);
    // The start state hangs on data-intro alone, so nothing shows early.
    expect(css).toMatch(/:root:not\(\[data-motion-paused\]\) \.hm-hero\[data-intro\] \.hd-draw \{ stroke-dasharray: 1 2; stroke-dashoffset: 1\.01; \}/);
  });
});

describe('lib/motion.ts holds the tilt numbers from the Hero boards', () => {
  it('has the pod growth and the fades', () => {
    expect(hero.rotor.podGrow).toBe(30);
    expect(hero.rotor.fade).toEqual({ blades: 1, tail: 0.6, tailHeat: 0.55 });
    expect(hero.rotor.nacelleShift).toBe(26);
  });
});
