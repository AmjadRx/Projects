/**
 * The live scene's life (components/sky/live/index.ts) with three.js replaced by a recording fake
 * and a fake page, since the real renderer needs WebGL: createSky without a WebGL context, the
 * frame loop's steps (the programs, the panorama, then the sky), start, stop and destroy, the
 * first frame against renderStill wherever the page was scrolled, the meteor's wait after a rest,
 * the drafting overlay's layer, and one draw per object. tests/sky-live.test.ts checks the math.
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SKY, toMs } from '../lib/motion';
import { lstDeg } from '../lib/sky/astro';
import { decodeStars } from '../lib/sky/stars';
import { SCROLL_TURN_MS, skyToPanorama } from '../components/sky/live/math';
import { DoubleSide } from 'three';
import { METEOR_FRAGMENT, MILKY_WAY_FRAGMENT, STAR_VERTEX } from '../components/sky/live/shaders';

const RAD = Math.PI / 180;

/** What the fake renderer does: fail to start, or report its programs ready or not yet. */
const fake = vi.hoisted(() => ({ fail: false, ready: true, renderers: [] as unknown[], materials: [] as Record<string, unknown>[] }));

vi.mock('three', () => {
  class BufferAttribute {
    constructor(
      public array: ArrayLike<number>,
      public itemSize: number,
    ) {}
  }
  class BufferGeometry {
    attributes: Record<string, unknown> = {};
    drawRange = { start: 0, count: Infinity };
    dispose = vi.fn();
    setAttribute(name: string, attribute: unknown) {
      this.attributes[name] = attribute;
      return this;
    }
    setDrawRange(start: number, count: number) {
      this.drawRange = { start, count };
    }
  }
  class RawShaderMaterial {
    [key: string]: unknown;
    dispose = vi.fn();
    constructor(parameters: Record<string, unknown>) {
      Object.assign(this, parameters);
      fake.materials.push(this);
    }
  }
  class Object3D {
    visible = true;
    frustumCulled = true;
    matrixAutoUpdate = true;
  }
  class Mesh extends Object3D {
    constructor(
      public geometry: unknown,
      public material: RawShaderMaterial,
    ) {
      super();
    }
  }
  class Points extends Mesh {}
  class Scene {
    children: Mesh[] = [];
    matrixAutoUpdate = true;
    add(object: Mesh) {
      this.children.push(object);
    }
    clear() {
      this.children = [];
    }
  }
  class OrthographicCamera {}
  class Texture {
    dispose = vi.fn();
    constructor(public image: unknown) {}
  }
  class WebGLRenderer {
    debug: { onShaderError: unknown } = { onShaderError: null };
    sortObjects = true;
    renders: { objects: { fragment: string; visible: boolean }[]; uniforms: Record<string, unknown> }[] = [];
    setSize = vi.fn();
    initTexture = vi.fn();
    dispose = vi.fn();
    forceContextLoss = vi.fn();
    properties = { get: () => ({ currentProgram: { isReady: () => fake.ready } }) };
    constructor(public parameters: Record<string, unknown>) {
      if (fake.fail) throw new Error('Error creating WebGL context.');
      fake.renderers.push(this);
    }
    setPixelRatio() {}
    getContext() {
      return { ALIASED_POINT_SIZE_RANGE: 0, getParameter: () => new Float32Array([1, 1024]) };
    }
    compile(scene: Scene) {
      return new Set(scene.children.map((o) => o.material));
    }
    render(scene: Scene) {
      const uniforms: Record<string, unknown> = {};
      for (const o of scene.children) {
        for (const [name, u] of Object.entries((o.material.uniforms as Record<string, { value: unknown }>) ?? {})) {
          const v = u.value;
          uniforms[name] = Array.isArray(v) ? [...v] : v instanceof Float32Array ? Array.from(v) : v;
        }
      }
      this.renders.push({
        objects: scene.children.map((o) => ({ fragment: String(o.material.fragmentShader), visible: o.visible })),
        uniforms,
      });
    }
  }
  const constants = Object.fromEntries(
    ['AddEquation', 'ClampToEdgeWrapping', 'CustomBlending', 'DoubleSide', 'GLSL3', 'LinearFilter', 'LinearMipmapLinearFilter', 'NoBlending', 'OneFactor', 'OneMinusSrcAlphaFactor', 'RepeatWrapping', 'ZeroFactor'].map((name, i) => [name, 1000 + i]),
  );
  return { ...constants, BufferAttribute, BufferGeometry, Mesh, OrthographicCamera, Points, RawShaderMaterial, Scene, Texture, WebGLRenderer };
});

import { createSky, type SkyController, type SkyData, type SkyOptions } from '../components/sky/live/index';

const ROOT = path.resolve(__dirname, '..');
const catalog = decodeStars(new Uint8Array(fs.readFileSync(path.join(ROOT, 'public/sky/stars.bin'))));

// ---------------------------------------------------------------------------------------------
// A fake page: canvases, a container, computed colors, animation frames and a clock
// ---------------------------------------------------------------------------------------------

interface FakeCanvas {
  width: number;
  height: number;
  className: string;
  style: Record<string, string>;
  removed: boolean;
  setAttribute: () => void;
  addEventListener: () => void;
  removeEventListener: () => void;
  remove: () => void;
  getContext: (kind: string) => unknown;
}

function makeCanvas(): FakeCanvas {
  const canvas: FakeCanvas = {
    width: 300,
    height: 150,
    className: '',
    style: {},
    removed: false,
    setAttribute() {},
    addEventListener() {},
    removeEventListener() {},
    remove() {
      canvas.removed = true;
    },
    getContext: (kind: string) =>
      kind === '2d'
        ? new Proxy({}, { get: (target: Record<string, unknown>, key: string) => (key in target ? target[key] : () => undefined), set: (target, key: string, value) => ((target[key] = value), true) })
        : null,
  };
  return canvas;
}

function makeLayer() {
  const children: FakeCanvas[] = [];
  return { children, appendChild: (child: FakeCanvas) => void children.push(child) };
}

let frames = new Map<number, (now: number) => void>();
let nextFrame = 1;
let clock = 0;

/** Runs the animation frames waiting at `now` (ms), as the browser would at its next frame. */
function frameAt(now: number): void {
  clock = now;
  const due = [...frames.values()];
  frames = new Map();
  for (const run of due) run(now);
}

beforeEach(() => {
  fake.fail = false;
  fake.ready = true;
  fake.renderers = [];
  fake.materials = [];
  frames = new Map();
  nextFrame = 1;
  clock = 0;
  vi.stubGlobal('document', { createElement: () => makeCanvas(), hidden: false });
  vi.stubGlobal('window', { devicePixelRatio: 1 });
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: (name: string) => (name === '--font-mono' ? 'monospace' : 'rgb(10, 20, 30)') }));
  vi.stubGlobal('requestAnimationFrame', (run: (now: number) => void) => {
    const id = nextFrame++;
    frames.set(id, run);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => void frames.delete(id));
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const START = Date.UTC(2026, 10, 17, 5, 0, 0);

function data(withPanorama = true): SkyData & { closed: () => boolean } {
  let closed = false;
  const bitmap = { width: 2048, height: 1024, close: () => void (closed = true) };
  return { stars: catalog, names: new Map([[0, 'Sirius']]), milkyWay: withPanorama ? (bitmap as unknown as ImageBitmap) : null, closed: () => closed };
}

function make(options: Partial<SkyOptions> = {}, skyData = data()) {
  const container = makeLayer();
  const errors: string[] = [];
  const ready = vi.fn();
  const sky: SkyController = createSky(container as unknown as HTMLElement, skyData, {
    theme: 'blueprint',
    tier: 'full',
    startTimeMs: START,
    getProgress: () => 0,
    onReady: ready,
    onFps: () => {},
    onError: (reason) => void errors.push(reason),
    ...options,
  });
  sky.setSize(1000, 800);
  const renderer = fake.renderers.at(-1) as { renders: { objects: { fragment: string; visible: boolean }[]; uniforms: Record<string, unknown> }[]; initTexture: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn>; forceContextLoss: ReturnType<typeof vi.fn>; parameters: Record<string, unknown> } | undefined;
  return { sky, container, errors, ready, renderer, skyData };
}

const shown = (render: { objects: { fragment: string; visible: boolean }[] }, fragment: string) => render.objects.find((o) => o.fragment === fragment)?.visible;

// ---------------------------------------------------------------------------------------------

describe('createSky without WebGL', () => {
  it('reports webgl on a microtask, does nothing, and removes its canvas on destroy', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fake.fail = true;
    const { sky, container, errors } = make();
    expect(errors).toEqual([]);
    await Promise.resolve();
    expect(errors).toEqual(['webgl']);
    sky.start();
    sky.renderStill(START);
    sky.setPointer({ x: 1, y: 1 });
    expect(frames.size).toBe(0);
    expect(container.children).toHaveLength(1);
    sky.destroy();
    expect(container.children[0].removed).toBe(true);
    expect(frames.size).toBe(0);
  });
});

describe('the frame loop', () => {
  it('waits for the programs, sends the panorama in a frame of its own, then draws; and stops and tears down cleanly', () => {
    fake.ready = false;
    const { sky, renderer, ready, skyData } = make();
    expect(renderer).toBeDefined();
    sky.start();
    expect(frames.size).toBe(1);
    frameAt(16);
    frameAt(32);
    // Still compiling: the loop only asks again, and draws nothing.
    expect(renderer!.renders).toHaveLength(0);
    expect(renderer!.initTexture).not.toHaveBeenCalled();
    expect(frames.size).toBe(1);

    fake.ready = true;
    frameAt(48);
    // The programs are ready: this frame sends the panorama, and frees its decoded copy.
    expect(renderer!.initTexture).toHaveBeenCalledTimes(1);
    expect(skyData.closed()).toBe(true);
    expect(renderer!.renders).toHaveLength(0);
    frameAt(64);
    expect(renderer!.renders).toHaveLength(1);
    expect(ready).not.toHaveBeenCalled();
    frameAt(80);
    expect(ready).toHaveBeenCalledTimes(1);
    expect(renderer!.renders).toHaveLength(2);

    sky.stop();
    expect(frames.size).toBe(0);
    sky.start();
    expect(frames.size).toBe(1);
    sky.destroy();
    expect(frames.size).toBe(0);
    expect(renderer!.dispose).toHaveBeenCalledTimes(1);
    expect(renderer!.forceContextLoss).toHaveBeenCalledTimes(1);
    sky.start();
    expect(frames.size).toBe(0);
  });

  it('sends no panorama in Whiteprint, which never draws it', () => {
    const { sky, renderer, skyData } = make({ theme: 'whiteprint' });
    sky.start();
    frameAt(16);
    expect(renderer!.initTexture).not.toHaveBeenCalled();
    expect(renderer!.renders).toHaveLength(1);
    expect(shown(renderer!.renders[0], MILKY_WAY_FRAGMENT)).toBe(false);
    expect(skyData.closed()).toBe(false);
    sky.destroy();
    // Destroyed, the scene frees the decoded panorama it never used.
    expect(skyData.closed()).toBe(true);
  });
});

describe('a Whiteprint start', () => {
  it('fetches the Milky Way only when the page turns Blueprint, and sends it to the GPU in a frame of its own', async () => {
    let closed = false;
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('createImageBitmap', async () => ({ width: 4096, height: 2048, close: () => void (closed = true) }));
    const { sky, renderer } = make({ theme: 'whiteprint' }, data(false));
    sky.start();
    frameAt(16);
    expect(fetchMock).not.toHaveBeenCalled();
    sky.setTheme('whiteprint');
    expect(fetchMock).not.toHaveBeenCalled();

    sky.setTheme('blueprint');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/sky/milkyway-4k.webp');
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    frameAt(32);
    expect(renderer!.initTexture).toHaveBeenCalledTimes(1);
    expect(closed).toBe(true);
    frameAt(48);
    expect(shown(renderer!.renders.at(-1)!, MILKY_WAY_FRAGMENT)).toBe(true);
    // Once is enough: turning Blueprint again fetches nothing more.
    sky.setTheme('whiteprint');
    sky.setTheme('blueprint');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    sky.destroy();
  });
});

describe('the first frame and the still', () => {
  it("draws the still's sky in its first frame wherever the page was scrolled, then turns with scroll from there", () => {
    let progress = 0.5;
    const { sky, renderer } = make({ getProgress: () => progress }, data(false));
    sky.start();
    frameAt(16);
    const first = renderer!.renders[0].uniforms;
    expect(first.uLst).toBeCloseTo(lstDeg(START, SKY.site.lon) * RAD, 12);
    expect(first.uPhase).toBe(0);
    expect(first.uToPanorama).toEqual(Array.from(skyToPanorama(lstDeg(START, SKY.site.lon), SKY.site.lat, SKY.facing)));

    sky.stop();
    sky.renderStill(START);
    const still = renderer!.renders[1].uniforms;
    expect(still.uLst).toBe(first.uLst);
    expect(still.uPhase).toBe(first.uPhase);
    expect(still.uToPanorama).toEqual(first.uToPanorama);

    // A quarter of a page further down: a quarter of SKY.scrollTurn more, after the time run.
    sky.start();
    progress = 0.75;
    frameAt(1016);
    frameAt(2016);
    const later = renderer!.renders.at(-1)!.uniforms;
    const expected = lstDeg(START + 1 * 1000 * SKY.speed + 0.25 * SCROLL_TURN_MS, SKY.site.lon) * RAD;
    expect(later.uLst).toBeCloseTo(expected, 9);
  });
});

describe('the meteor', () => {
  it('waits a fresh 10 to 20 s after the loop rests, instead of firing on the first frame back', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const { sky, renderer } = make({}, data(false));
    sky.start();
    for (let t = 16; t <= 5000; t += 16) frameAt(t);
    expect(renderer!.renders.every((r) => !shown(r, METEOR_FRAGMENT))).toBe(true);
    sky.stop();
    // Asleep for 35 s (the idle rest), long past the moment the next meteor was due.
    sky.start();
    frameAt(40_000);
    expect(shown(renderer!.renders.at(-1)!, METEOR_FRAGMENT)).toBe(false);
    for (let t = 40_016; t < 40_000 + toMs(SKY.meteorEvery[0]); t += 16) frameAt(t);
    expect(renderer!.renders.slice(-10).some((r) => shown(r, METEOR_FRAGMENT))).toBe(false);
    frameAt(40_000 + toMs(SKY.meteorEvery[0]) + 16);
    expect(shown(renderer!.renders.at(-1)!, METEOR_FRAGMENT)).toBe(true);
    sky.destroy();
  });
});

describe('the drafting overlay', () => {
  it('draws in the labels layer it is given, and only for a pointer resting on empty sky', () => {
    const labels = makeLayer();
    const { sky, container } = make({ overlay: labels as unknown as HTMLElement }, data(false));
    sky.start();
    frameAt(16);
    // Over the page's text: the parallax moves, but no drafting lines are drawn.
    sky.setPointer({ x: 500, y: 300, emptySky: false });
    for (let t = 32; t <= 1000; t += 16) frameAt(t);
    expect(labels.children).toHaveLength(0);
    // On empty sky, after the rest: the overlay's canvas goes into the labels layer, not the scene's.
    sky.setPointer({ x: 500, y: 300, emptySky: true });
    for (let t = 1016; t <= 1016 + toMs(SKY.drafting.rest) + 100; t += 16) frameAt(t);
    expect(labels.children).toHaveLength(1);
    expect(container.children).toHaveLength(1);
    sky.destroy();
    expect(labels.children[0].removed).toBe(true);
  });
});

describe('the materials', () => {
  it('are drawn in one pass each with both sides, so no object (the star points above all) is drawn twice', () => {
    make({}, data(false));
    // Five programs: the sky, the Milky Way, the stars, the meteor and the ground.
    expect(fake.materials).toHaveLength(5);
    expect(fake.materials.some((m) => m.vertexShader === STAR_VERTEX)).toBe(true);
    for (const m of fake.materials) {
      // three draws a transparent double-sided material twice (back faces, then front faces) unless
      // it is single-pass; points have no faces, so the stars would be composited twice.
      expect(m.transparent).toBe(true);
      expect(m.side).toBe(DoubleSide);
      expect(m.forceSinglePass).toBe(true);
    }
  });
});
