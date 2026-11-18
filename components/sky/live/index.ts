/**
 * The live sky: the deferred chunk, and the only code on the site that imports three.js (plain
 * three with named imports; no React Three Fiber in the sky, decided by measurement, Q-27). The
 * host (components/sky/Sky.tsx) imports it after the page is interactive and idle, and drives it
 * through the contract below (phase 5's SKY_API.md); the stills harness (app/dev-sky) mounts it
 * alone.
 *
 * It draws the design bundle's reference renderer (the Sky component's canvas renderer) from the
 * same data, numbers and order, in WebGL: the sky's gradient, the Milky Way, the stars (one points
 * draw call), the meteor, then the ground with its grid, the horizon line and the ripple, and in a
 * 2D overlay (the host's labels layer, above the dawn) the drafting lines and the star name. The
 * dawn is not drawn here: the host's CSS layer draws it on every tier. Numbers come from SKY in
 * lib/motion.ts, the astronomy from lib/sky/astro.ts, colors from the CSS variables of
 * app/tokens.css.
 *
 * Its start is split into steps, so no single task holds it (R-05): the host asks `canRender`
 * first (it makes the WebGL context, which createSky then reuses), the star attributes are built
 * in slices while the data loads, the shader programs compile in the driver's own time while the
 * loop waits, the Milky Way goes to the GPU in a frame of its own, and the sky is drawn in the
 * frame after.
 */
import {
  AddEquation,
  BufferAttribute,
  BufferGeometry,
  ClampToEdgeWrapping,
  CustomBlending,
  DoubleSide,
  GLSL3,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  NoBlending,
  OneFactor,
  OneMinusSrcAlphaFactor,
  OrthographicCamera,
  Points,
  RawShaderMaterial,
  RepeatWrapping,
  Scene,
  Texture,
  WebGLRenderer,
  ZeroFactor,
  type IUniform,
  type Material,
} from 'three';
import { SKY, toMs } from '@/lib/motion';
import { lstDeg, projScale } from '@/lib/sky/astro';
import { STARS_PATH, STAR_NAMES_PATH, countBrighterThan, decodeStars, parseStarNames, type StarCatalog } from '@/lib/sky/stars';
import { readSkyColors, type SkyColors } from './colors';
import {
  buildStarAttributes,
  clamp01,
  cubicBezier,
  emptyStarAttributes,
  fillStarAttributes,
  groundPhase,
  horizonY,
  meteorGap,
  meteorStreak,
  placeStar,
  scrolledSince,
  selectDrafting,
  shimmerAngle,
  simTimeMs,
  skyToPanorama,
  smoothingFactor,
  spawnMeteor,
  type BrightStar,
  type Meteor,
  type StarAttributes,
} from './math';
import { DraftingOverlay } from './overlay';
import {
  FULLSCREEN_VERTEX,
  GROUND_FRAGMENT,
  METEOR_FRAGMENT,
  METEOR_VERTEX,
  MILKY_WAY_FRAGMENT,
  SKY_FRAGMENT,
  STAR_FRAGMENT,
  STAR_VERTEX,
} from './shaders';

// ---------------------------------------------------------------------------------------------
// The contract
// ---------------------------------------------------------------------------------------------

export type SkyTheme = 'blueprint' | 'whiteprint';
export type SkyTier = 'full' | 'light';
/** The decoded catalogue (lib/sky/stars.ts), brightest first. */
export type DecodedStars = StarCatalog;

export interface SkyData {
  stars: DecodedStars;
  /** Star index to IAU name (the brightest 150 with a name). */
  names: Map<number, string>;
  /** The ESO panorama: 4K on Full, 2K on Light; null when it could not be loaded. */
  milkyWay: ImageBitmap | HTMLImageElement | null;
}

export interface SkyOptions {
  theme: SkyTheme;
  tier: SkyTier;
  /** The clock time whose sidereal time the scene starts from (the still's step). */
  startTimeMs: number;
  /** Scroll progress 0 to 1, read every frame. */
  getProgress: () => number;
  /** After the first frame is on screen. */
  onReady: () => void;
  /** About every SKY.scene.fpsEvery seconds while running. */
  onFps: (fps: number) => void;
  /** WebGL could not start, the context was lost, or a shader failed: the host goes to Still. */
  onError?: (reason: string) => void;
  /**
   * Where the drafting overlay's canvas goes: the host's labels layer, above the dawn, so the
   * names and lines are not tinted by it (the reference draws them after the dawn). The container
   * when absent.
   */
  overlay?: HTMLElement;
  /** Only in the stills harness: preserveDrawingBuffer, and no frame loop. */
  still?: boolean;
}

/**
 * The pointer in CSS px. `emptySky: false` means it is over the page's text, a panel or a control:
 * it still moves the parallax, but no drafting lines are drawn for it. Absent means empty sky.
 */
export interface SkyPointer {
  x: number;
  y: number;
  emptySky?: boolean;
}

export interface SkyController {
  /** CSS px of the viewport; the scene applies the device pixel ratio cap. */
  setSize(width: number, height: number): void;
  /** Re-reads the CSS colors. */
  setTheme(theme: SkyTheme): void;
  setTier(tier: SkyTier): void;
  setPointer(p: SkyPointer | null): void;
  ripple(x: number, y: number): void;
  /** Runs the frame loop. */
  start(): void;
  /** Stops the frame loop: no frames run. */
  stop(): void;
  /** One frame, at once: no parallax, meteor, shimmer, ripple or labels; progress 0, ground phase 0. */
  renderStill(timeMs: number): void;
  /** Disposes every GPU resource and removes its elements; leaves no listener or frame callback. */
  destroy(): void;
}

/** The Milky Way panorama for each tier (public/sky, written by scripts/build-sky.mjs). */
export const MILKY_WAY_PATHS = { full: '/sky/milkyway-4k.webp', light: '/sky/milkyway-2k.webp' } as const;

// ---------------------------------------------------------------------------------------------
// The WebGL context
// ---------------------------------------------------------------------------------------------

/** The live sky's context. failIfMajorPerformanceCaveat: a software renderer would only crawl. */
const LIVE_CONTEXT: WebGLContextAttributes = {
  alpha: true,
  premultipliedAlpha: true,
  antialias: false,
  depth: false,
  stencil: false,
  preserveDrawingBuffer: false,
  powerPreference: 'low-power',
  failIfMajorPerformanceCaveat: true,
};

/** The context `canRender` made, kept for the next createSky so the sky makes only one. */
let spare: { canvas: HTMLCanvasElement; context: WebGL2RenderingContext } | null = null;

/**
 * True when this browser can draw the live sky: it makes the WebGL2 context the scene will use,
 * with the live sky's attributes (a blocked or software-only GPU answers false), and keeps it for
 * the next createSky. The host asks before loadSkyData, so a machine that cannot draw the sky
 * downloads none of its data. Never throws.
 */
export function canRender(): boolean {
  if (spare && !spare.context.isContextLost()) return true;
  spare = null;
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl2', LIVE_CONTEXT);
    if (!context) return false;
    spare = { canvas, context };
    return true;
  } catch {
    return false;
  }
}

function takeSpare(): { canvas: HTMLCanvasElement; context: WebGL2RenderingContext } | null {
  const kept = spare;
  spare = null;
  return kept && !kept.context.isContextLost() ? kept : null;
}

// ---------------------------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------------------------

/** Gives the main thread back to the browser for a moment (scheduler.yield where there is one). */
function yieldToMain(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (scheduler && typeof scheduler.yield === 'function') return scheduler.yield();
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** The star attributes prepared while the data loaded, by catalogue; createSky takes them from here. */
const prepared = new WeakMap<StarCatalog, StarAttributes>();

/** Builds the star shader's attributes in slices of at most SKY.liveLoad.slice seconds of work. */
async function prepareStars(catalog: StarCatalog): Promise<void> {
  const attrs = emptyStarAttributes(catalog.count);
  const slice = toMs(SKY.liveLoad.slice);
  let from = 0;
  while (from < attrs.count) {
    const began = performance.now();
    while (from < attrs.count && performance.now() - began < slice) {
      fillStarAttributes(catalog, attrs, from, from + 1);
      from += 1;
    }
    if (from < attrs.count) await yieldToMain();
  }
  prepared.set(catalog, attrs);
}

async function loadImage(url: string): Promise<ImageBitmap | HTMLImageElement> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const blob = await res.blob();
  if (typeof createImageBitmap === 'function') {
    try {
      // Decoded off the main thread, with its pixel values as they are (no color management), as
      // the reference reads them through getImageData.
      return await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    } catch {
      // Fall back to an image element below.
    }
  }
  const src = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = src;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(src);
  }
}

/**
 * Fetches the catalogue (public/sky/stars.bin), the star names and the Milky Way for a tier, and
 * prepares the stars for the shader in yielding steps. It rejects only when the catalogue cannot
 * be read; without names the sky draws no names, and without the panorama it draws no Milky Way.
 * For a Whiteprint page (`theme`), which shows no Milky Way, the panorama is not fetched at all:
 * the scene fetches it itself if the page turns Blueprint.
 */
export async function loadSkyData(tier: SkyTier, theme: SkyTheme = 'blueprint'): Promise<SkyData> {
  const stars = fetch(STARS_PATH).then((res) => {
    if (!res.ok) throw new Error(`${STARS_PATH}: HTTP ${res.status}`);
    return res.arrayBuffer();
  });
  const names = fetch(STAR_NAMES_PATH)
    .then((res) => (res.ok ? (res.json() as Promise<unknown>) : {}))
    .catch(() => ({}));
  const milkyWay = theme === 'blueprint' ? loadImage(MILKY_WAY_PATHS[tier]).catch(() => null) : Promise.resolve(null);
  const [buffer, namesJson, image] = await Promise.all([stars, names, milkyWay]);
  const catalog = decodeStars(buffer);
  await yieldToMain();
  await prepareStars(catalog);
  let named: Map<number, string>;
  try {
    named = parseStarNames(namesJson, catalog.count);
  } catch {
    named = new Map();
  }
  return { stars: catalog, names: named, milkyWay: image };
}

// ---------------------------------------------------------------------------------------------
// The scene
// ---------------------------------------------------------------------------------------------

const RAD = Math.PI / 180;

type Vec2 = [number, number];
type Vec3 = [number, number, number];

interface DrawState {
  simTime: number;
  /** The smoothed pointer, -1 to 1 on each axis (0, 0 at the centre or with no pointer). */
  shift: Vec2;
  /** The shimmer clock's angle, or null for no shimmer. */
  shimmer: number | null;
  /** The ground phase, 0 to one row. */
  phase: number;
  meteor: { head: Vec2; tail: Vec2; alpha: number } | null;
  /** x, y in CSS px and progress 0 to 1. */
  ripple: Vec3 | null;
  /** How far the drafting lines have drawn and the name has faded in, both eased; null for none. */
  labels: { drawn: number; name: number } | null;
}

type Blend = 'opaque' | 'add' | 'over';

function shaderMaterial(vertexShader: string, fragmentShader: string, uniforms: Record<string, IUniform>, blend: Blend): RawShaderMaterial {
  const m = new RawShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms,
    glslVersion: GLSL3,
    depthTest: false,
    depthWrite: false,
    // Screen-space geometry: no face is a back face (the meteor's quad is laid out in CSS px, whose
    // y runs down, so its triangles turn the other way in clip space and would be culled).
    side: DoubleSide,
    // Every object in one render list, drawn in the order it was added (sortObjects is off).
    transparent: true,
    // One draw per object. Without it three draws a transparent double-sided object twice, its
    // back faces and then its front faces, which composites the star points twice.
    forceSinglePass: true,
  });
  if (blend === 'opaque') {
    m.blending = NoBlending;
  } else {
    m.blending = CustomBlending;
    m.blendEquation = AddEquation;
    m.blendEquationAlpha = AddEquation;
    m.blendSrc = OneFactor;
    // 'add': the Milky Way adds light and leaves alpha; 'over': premultiplied source over.
    m.blendDst = blend === 'add' ? OneFactor : OneMinusSrcAlphaFactor;
    m.blendSrcAlpha = blend === 'add' ? ZeroFactor : OneFactor;
    m.blendDstAlpha = blend === 'add' ? OneFactor : OneMinusSrcAlphaFactor;
  }
  return m;
}

const u = <T>(value: T): IUniform<T> => ({ value });

/** An image that can be closed (an ImageBitmap): its decoded pixels are freed at once. */
function closeImage(image: SkyData['milkyWay']): void {
  const closable = image as { close?: () => void } | null;
  if (closable && typeof closable.close === 'function') closable.close();
}

/**
 * Builds the scene in `container` (it appends a WebGL canvas, and on the Full tier a 2D overlay in
 * `options.overlay`) and returns its controller. It never throws for want of WebGL: when no WebGL2
 * context can be made (or only a software one, outside the stills harness), it reports
 * `onError('webgl')` on the next microtask and returns a controller that does nothing.
 */
export function createSky(container: HTMLElement, data: SkyData, options: SkyOptions): SkyController {
  const still = options.still === true;
  let theme: SkyTheme = options.theme;
  let tier: SkyTier = options.tier;
  let destroyed = false;
  let failed = false;
  let running = false;
  let raf = 0;

  // The context canRender made, when there is one (never in the stills harness, which needs
  // preserveDrawingBuffer).
  const reuse = still ? null : takeSpare();
  const canvas = reuse ? reuse.canvas : document.createElement('canvas');
  canvas.className = 'ar-sky__canvas';
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, { position: 'absolute', left: '0', top: '0', width: '100%', height: '100%', display: 'block' });
  container.appendChild(canvas);

  function stop(): void {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  function fail(reason: string): void {
    if (failed || destroyed) return;
    failed = true;
    stop();
    queueMicrotask(() => {
      if (!destroyed) options.onError?.(reason);
    });
  }

  let renderer: WebGLRenderer | null = null;
  try {
    renderer = new WebGLRenderer({
      canvas,
      // three's types name the WebGL 1 context; r169 takes (and needs) a WebGL2 one.
      context: reuse ? (reuse.context as unknown as WebGLRenderingContext) : undefined,
      alpha: LIVE_CONTEXT.alpha,
      premultipliedAlpha: LIVE_CONTEXT.premultipliedAlpha,
      antialias: LIVE_CONTEXT.antialias,
      depth: LIVE_CONTEXT.depth,
      stencil: LIVE_CONTEXT.stencil,
      preserveDrawingBuffer: still,
      powerPreference: LIVE_CONTEXT.powerPreference,
      // A software renderer would only crawl: the live sky leaves the still in place instead.
      failIfMajorPerformanceCaveat: !still,
    });
  } catch {
    renderer = null;
  }

  if (!renderer) {
    fail('webgl');
    return {
      setSize() {},
      setTheme() {},
      setTier() {},
      setPointer() {},
      ripple() {},
      start() {},
      stop() {},
      renderStill() {},
      destroy() {
        destroyed = true;
        canvas.remove();
      },
    };
  }
  const gl: WebGLRenderer = renderer;
  gl.setPixelRatio(1);
  gl.sortObjects = false;
  gl.debug.onShaderError = () => fail('shader');
  const glContext = gl.getContext();
  const pointRange = glContext.getParameter(glContext.ALIASED_POINT_SIZE_RANGE) as Float32Array | null;
  const maxPoint = pointRange && pointRange.length > 1 ? pointRange[1] : 64;

  const onContextLost = () => fail('webgl-context-lost');
  canvas.addEventListener('webglcontextlost', onContextLost);

  // ---- Shared uniforms (one object per value, shared by the materials that read it) ----------
  const uRes = u<Vec2>([1, 1]);
  const uScale = u<Vec2>([1, 1]);
  const uWidth = u(1);
  const uHeight = u(1);
  const uHorizon = u(1);
  const uK = u(1);
  const lat = SKY.site.lat * RAD;

  const attrs = prepared.get(data.stars) ?? buildStarAttributes(data.stars);
  const fullCount = countBrighterThan(data.stars, SKY.scene.star.limit);
  const lightCount = countBrighterThan(data.stars, SKY.lightTierLimit);
  const brightIndexes: number[] = [];
  for (let i = 0; i < data.stars.count && data.stars.vmag[i] < SKY.drafting.brightLimit; i += 1) brightIndexes.push(i);

  const settle = cubicBezier(SKY.drafting.drawEase);
  const fade = cubicBezier(SKY.drafting.nameEase);

  let colors: SkyColors = readSkyColors(container);
  const overlayHost = options.overlay ?? container;
  let overlay: DraftingOverlay | null = null;
  let cssW = 0;
  let cssH = 0;
  let dpr = 1;

  // ---- Loop state -----------------------------------------------------------------------------
  let readyRaf = 0;
  let ready = false;
  let lastFrameAt = -1;
  let elapsed = 0;
  /** The scroll progress at the first drawn frame: the scene counts scroll from there (scrolledSince). */
  let progressFrom: number | null = null;
  let pointer: { x: number; y: number } | null = null;
  /** False while the pointer is over the page's text, a panel or a control: no drafting lines. */
  let pointerLabels = true;
  let lastMove = -Infinity;
  const smooth: Vec2 = [0, 0];
  let meteor: { m: Meteor; t0: number } | null = null;
  let nextMeteorAt = 0;
  let ripple: { x: number; y: number; t0: number } | null = null;
  let fpsSince = -1;
  let fpsFrames = 0;
  let lastDraw: DrawState | null = null;

  // ---- Geometry -------------------------------------------------------------------------------
  const triangle = new BufferGeometry();
  triangle.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 3, -1, -1, 3]), 2));
  const quad = new BufferGeometry();
  quad.setAttribute('position', new BufferAttribute(new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), 2));
  const starGeometry = new BufferGeometry();
  starGeometry.setAttribute('aRaDec', new BufferAttribute(attrs.raDec, 2));
  starGeometry.setAttribute('aMag', new BufferAttribute(attrs.vmag, 1));
  starGeometry.setAttribute('aColor', new BufferAttribute(attrs.color, 3, true));
  starGeometry.setAttribute('aDepth', new BufferAttribute(attrs.depth, 1));
  starGeometry.setAttribute('aPhase', new BufferAttribute(attrs.phase, 1));
  starGeometry.setDrawRange(0, tier === 'full' ? fullCount : lightCount);

  // ---- The Milky Way panorama -----------------------------------------------------------------
  let panorama: Texture | null = null;
  let image: SkyData['milkyWay'] = null;
  /** True once the panorama is on the GPU (or there is none). Only a Blueprint frame sends it. */
  let uploaded = true;
  /** A Whiteprint start loads no panorama; turning Blueprint fetches it, once. */
  let fetchedLate = false;

  function adoptPanorama(next: SkyData['milkyWay']): void {
    // A closed ImageBitmap (one a scene already sent to the GPU) has no size left: no Milky Way.
    if (!next || !(next.width > 0 && next.height > 0)) return;
    image = next;
    panorama = new Texture(next);
    // Rows from the top, as galacticToPanorama counts v; an ImageBitmap ignores flipY anyway.
    panorama.flipY = false;
    panorama.generateMipmaps = true;
    panorama.minFilter = LinearMipmapLinearFilter;
    panorama.magFilter = LinearFilter;
    panorama.wrapS = RepeatWrapping;
    panorama.wrapT = ClampToEdgeWrapping;
    panorama.needsUpdate = true;
    uploaded = false;
  }
  adoptPanorama(data.milkyWay);

  /** The panorama reached the GPU: its decoded copy (32 MB for the 4K one) is freed at once. */
  function markUploaded(): void {
    if (uploaded) return;
    uploaded = true;
    closeImage(image);
  }

  // ---- Materials ------------------------------------------------------------------------------
  const skyUniforms = { uRes, uScale, uHorizon, uZenith: u<Vec3>([0, 0, 0]), uMid: u<Vec3>([0, 0, 0]), uLow: u<Vec3>([0, 0, 0]) };
  const milkyWayUniforms = {
    uRes,
    uScale,
    uHorizon,
    uWidth,
    uK,
    uOffset: u<Vec2>([0, 0]),
    uToPanorama: u<Float32Array>(new Float32Array(9)),
    uPanorama: u<Texture | null>(panorama),
  };

  /**
   * The page turned Blueprint after a Whiteprint start, which loaded no panorama: fetch it now
   * (once), and draw it from the next frame that has it.
   */
  function fetchPanoramaLate(): void {
    if (panorama || fetchedLate || still || theme !== 'blueprint' || data.milkyWay) return;
    fetchedLate = true;
    loadImage(MILKY_WAY_PATHS[tier]).then(
      (late) => {
        if (destroyed || failed) {
          closeImage(late);
          return;
        }
        adoptPanorama(late);
        milkyWayUniforms.uPanorama.value = panorama;
        applyTheme();
        redrawIfIdle();
      },
      () => undefined,
    );
  }
  const starUniforms = {
    uRes,
    uScale,
    uWidth,
    uHorizon,
    uK,
    uLst: u(0),
    uLat: u<Vec2>([Math.sin(lat), Math.cos(lat)]),
    uFacing: u(SKY.facing * RAD),
    uShift: u<Vec2>([0, 0]),
    uShimmer: u<Vec2>([0, 0]),
    uMaxPoint: u(maxPoint),
  };
  const meteorUniforms = { uRes, uScale, uHead: u<Vec2>([0, 0]), uTail: u<Vec2>([0, 0]), uAlpha: u(0), uColor: u<Vec3>([1, 1, 1]) };
  const groundUniforms = {
    uRes,
    uScale,
    uWidth,
    uHeight,
    uHorizon,
    uFill: u<Vec3>([0, 0, 0]),
    uLine: u<Vec3>([0, 0, 0]),
    uVanish: u(0),
    uPhase: u(0),
    uRipple: u<[number, number, number, number]>([0, 0, 0, 0]),
  };

  const skyMaterial = shaderMaterial(FULLSCREEN_VERTEX, SKY_FRAGMENT, skyUniforms, 'opaque');
  const milkyWayMaterial = shaderMaterial(FULLSCREEN_VERTEX, MILKY_WAY_FRAGMENT, milkyWayUniforms, 'add');
  const starMaterial = shaderMaterial(STAR_VERTEX, STAR_FRAGMENT, starUniforms, 'over');
  const meteorMaterial = shaderMaterial(METEOR_VERTEX, METEOR_FRAGMENT, meteorUniforms, 'over');
  const groundMaterial = shaderMaterial(FULLSCREEN_VERTEX, GROUND_FRAGMENT, groundUniforms, 'opaque');

  // ---- Objects, in the reference's drawing order ----------------------------------------------
  const skyMesh = new Mesh(triangle, skyMaterial);
  const milkyWayMesh = new Mesh(triangle, milkyWayMaterial);
  const starPoints = new Points(starGeometry, starMaterial);
  const meteorMesh = new Mesh(quad, meteorMaterial);
  const groundMesh = new Mesh(triangle, groundMaterial);
  const objects = [skyMesh, milkyWayMesh, starPoints, meteorMesh, groundMesh];
  const scene = new Scene();
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  for (const o of objects) {
    o.frustumCulled = false;
    o.matrixAutoUpdate = false;
    scene.add(o);
  }
  scene.matrixAutoUpdate = false;

  // ---- Colors, theme, tier, size --------------------------------------------------------------
  function applyColors(): void {
    colors = readSkyColors(container);
    skyUniforms.uZenith.value = colors.zenith;
    skyUniforms.uMid.value = colors.mid;
    skyUniforms.uLow.value = colors.low;
    // As the reference: Blueprint's ground is --ground; Whiteprint's is the sheet.
    groundUniforms.uFill.value = theme === 'blueprint' ? colors.ground : colors.sheet;
    groundUniforms.uLine.value = colors.line;
    meteorUniforms.uColor.value = colors.ink;
  }

  function applyTheme(): void {
    const blue = theme === 'blueprint';
    skyMesh.visible = blue;
    milkyWayMesh.visible = blue && panorama !== null;
    starPoints.visible = blue;
    meteorMesh.visible = false;
    if (!blue) meteor = null;
  }

  function capDpr(): number {
    const device = typeof window !== 'undefined' && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
    return Math.min(tier === 'full' ? SKY.dpr.full : SKY.dpr.light, device);
  }

  function applySize(): void {
    dpr = capDpr();
    const bw = Math.max(1, Math.round(cssW * dpr));
    const bh = Math.max(1, Math.round(cssH * dpr));
    gl.setSize(bw, bh, false);
    uRes.value = [bw, bh];
    uScale.value = cssW > 0 && cssH > 0 ? [bw / cssW, bh / cssH] : [dpr, dpr];
    uWidth.value = Math.max(1, cssW);
    uHeight.value = Math.max(1, cssH);
    const hy = horizonY(cssH);
    uHorizon.value = Math.max(1, hy);
    uK.value = projScale(Math.max(1, cssW), Math.max(1, hy));
    overlay?.setSize(cssW, cssH, dpr);
  }

  function removeOverlay(): void {
    overlay?.destroy();
    overlay = null;
  }

  function overlayFor(labels: DrawState['labels']): DraftingOverlay | null {
    if (!labels || still || tier !== 'full' || theme !== 'blueprint' || !pointer) return overlay;
    if (!overlay) {
      overlay = new DraftingOverlay(overlayHost);
      overlay.setSize(cssW, cssH, dpr);
    }
    return overlay;
  }

  applyColors();

  // Start every program (hidden objects too, so the first meteor does not stall), without waiting
  // for it: the loop's first frames only ask the driver whether the programs are ready
  // (KHR_parallel_shader_compile; without it they report ready at once and the first draw waits).
  // The stills harness draws at once instead, and its first draw finishes the programs.
  for (const o of objects) o.visible = true;
  const compiling: Set<Material> = gl.compile(scene, camera);
  applyTheme();
  let compiled = still;

  /** True once the driver reports every program linked. */
  function programsReady(): boolean {
    for (const material of compiling) {
      const program = (gl.properties.get(material) as { currentProgram?: { isReady?: () => boolean } } | undefined)?.currentProgram;
      if (!program || typeof program.isReady !== 'function' || program.isReady()) compiling.delete(material);
    }
    return compiling.size === 0;
  }

  // ---- Drawing --------------------------------------------------------------------------------
  function draw(state: DrawState): void {
    if (destroyed || failed || cssW < 1 || cssH < 1) return;
    const lst = lstDeg(state.simTime, SKY.site.lon);
    const [sx, sy] = state.shift;

    starUniforms.uLst.value = lst * RAD;
    starUniforms.uShift.value = [sx * SKY.parallax.x, sy * SKY.parallax.y];
    starUniforms.uShimmer.value = state.shimmer === null ? [0, 0] : [state.shimmer, 1];
    milkyWayUniforms.uToPanorama.value = skyToPanorama(lst, SKY.site.lat, SKY.facing);
    milkyWayUniforms.uOffset.value = [sx * SKY.parallax.milkyWayX, sy * SKY.parallax.milkyWayY];
    groundUniforms.uVanish.value = cssW / 2 + sx * SKY.parallax.vanishingPoint;
    groundUniforms.uPhase.value = state.phase;
    groundUniforms.uRipple.value = state.ripple ? [state.ripple[0], state.ripple[1], state.ripple[2], 1] : [0, 0, 0, 0];

    const showMeteor = state.meteor !== null && theme === 'blueprint' && tier === 'full';
    meteorMesh.visible = showMeteor;
    if (showMeteor && state.meteor) {
      meteorUniforms.uHead.value = state.meteor.head;
      meteorUniforms.uTail.value = state.meteor.tail;
      meteorUniforms.uAlpha.value = state.meteor.alpha;
    }

    gl.render(scene, camera);
    // Drawing the Milky Way sent the panorama to the GPU if it was not there yet.
    if (milkyWayMesh.visible) markUploaded();
    lastDraw = state;
    if (failed) return;

    const ov = overlayFor(state.labels);
    if (ov) {
      if (state.labels && pointer && tier === 'full' && theme === 'blueprint') {
        const frame = { lst, width: cssW, height: cssH, shiftX: sx * SKY.parallax.x, shiftY: sy * SKY.parallax.y };
        const bright: BrightStar[] = [];
        for (const i of brightIndexes) {
          const placed = placeStar(data.stars.ra[i], data.stars.dec[i], data.stars.vmag[i], attrs.depth[i], frame);
          if (placed) bright.push({ x: placed.x, y: placed.y, v: data.stars.vmag[i], name: data.names.get(i) ?? '' });
        }
        ov.draw(selectDrafting(bright, pointer), state.labels.drawn, state.labels.name, colors);
      } else {
        ov.clear();
      }
    }

    if (!ready) {
      ready = true;
      // The next animation frame starts after this one has been presented.
      readyRaf = requestAnimationFrame(() => {
        readyRaf = 0;
        if (!destroyed && !failed) options.onReady();
      });
    }
  }

  function redrawIfIdle(): void {
    if (!running && lastDraw && typeof document !== 'undefined' && !document.hidden) draw(lastDraw);
  }

  function readProgress(): number {
    try {
      return clamp01(options.getProgress());
    } catch {
      return 0;
    }
  }

  function frame(now: number): void {
    raf = 0;
    if (!running || destroyed || failed) return;
    if (!compiled && !(compiled = programsReady())) {
      // The programs are still compiling: ask again next frame, with nothing drawn.
      raf = requestAnimationFrame(frame);
      return;
    }
    if (!uploaded && panorama && theme === 'blueprint') {
      // This frame only sends the panorama to the GPU; the sky is drawn in the next one.
      gl.initTexture(panorama);
      markUploaded();
      raf = requestAnimationFrame(frame);
      return;
    }
    const dt = lastFrameAt < 0 ? 0 : Math.max(0, (now - lastFrameAt) / 1000);
    lastFrameAt = now;
    elapsed += dt;
    if (capDpr() !== dpr) applySize();

    // The pointer, smoothed with SKY.parallax.smoothing as a time constant.
    const tx = pointer && cssW > 0 ? (pointer.x / cssW) * 2 - 1 : 0;
    const ty = pointer && cssH > 0 ? (pointer.y / cssH) * 2 - 1 : 0;
    const a = smoothingFactor(dt, SKY.parallax.smoothing);
    smooth[0] += (tx - smooth[0]) * a;
    smooth[1] += (ty - smooth[1]) * a;
    // Scroll counts from the first drawn frame, so that frame is the still's sky wherever the page
    // was when the scene started.
    const progress = readProgress();
    if (progressFrom === null) progressFrom = progress;
    const scrolled = scrolledSince(progress, progressFrom);

    // The meteor (Full tier, Blueprint): at most one at a time, every SKY.meteorEvery seconds.
    let streak: DrawState['meteor'] = null;
    if (tier === 'full' && theme === 'blueprint') {
      if (!nextMeteorAt) nextMeteorAt = now + toMs(meteorGap(Math.random()));
      if (!meteor && now > nextMeteorAt) {
        meteor = { m: spawnMeteor(cssW, cssH, Math.random), t0: now };
        nextMeteorAt = now + toMs(meteorGap(Math.random()));
      }
      if (meteor) {
        const k = (now - meteor.t0) / toMs(SKY.meteor.duration);
        if (k >= 1) meteor = null;
        else streak = meteorStreak(meteor.m, Math.max(0, k));
      }
    } else {
      meteor = null;
    }

    // The ripple: linear over SKY.ripple.duration.
    let rippleNow: Vec3 | null = null;
    if (ripple) {
      const k = (now - ripple.t0) / toMs(SKY.ripple.duration);
      if (k >= 1) ripple = null;
      else rippleNow = [ripple.x, ripple.y, Math.max(0, k)];
    }

    // The drafting lines, once the pointer has rested on empty sky (Full tier, Blueprint).
    let labels: DrawState['labels'] = null;
    if (pointer && pointerLabels && tier === 'full' && theme === 'blueprint') {
      const restAt = lastMove + toMs(SKY.drafting.rest);
      if (now >= restAt) {
        const t = (now - restAt) / 1000;
        labels = {
          drawn: settle(clamp01(t / SKY.drafting.draw)),
          name: fade(clamp01((t - SKY.drafting.nameAfter) / SKY.drafting.nameFade)),
        };
      }
    }

    draw({
      simTime: simTimeMs(options.startTimeMs, elapsed, scrolled),
      shift: [smooth[0], smooth[1]],
      shimmer: shimmerAngle(elapsed),
      phase: groundPhase(elapsed, scrolled),
      meteor: streak,
      ripple: rippleNow,
      labels,
    });
    if (!running || destroyed || failed) return;
    raf = requestAnimationFrame(frame);

    // The frame rate, about every SKY.scene.fpsEvery seconds.
    if (fpsSince < 0) {
      fpsSince = now;
      fpsFrames = 0;
    } else {
      fpsFrames += 1;
      const span = now - fpsSince;
      if (span >= toMs(SKY.scene.fpsEvery)) {
        fpsSince = now;
        const frames = fpsFrames;
        fpsFrames = 0;
        options.onFps((frames * 1000) / span);
      }
    }
  }

  return {
    setSize(width: number, height: number) {
      if (destroyed) return;
      cssW = Number.isFinite(width) ? Math.max(0, width) : 0;
      cssH = Number.isFinite(height) ? Math.max(0, height) : 0;
      if (failed) return;
      applySize();
      redrawIfIdle();
    },
    setTheme(next: SkyTheme) {
      if (destroyed) return;
      theme = next;
      if (failed) return;
      applyColors();
      applyTheme();
      overlay?.clear();
      fetchPanoramaLate();
      redrawIfIdle();
    },
    setTier(next: SkyTier) {
      if (destroyed || next === tier) return;
      tier = next;
      if (failed) return;
      starGeometry.setDrawRange(0, tier === 'full' ? fullCount : lightCount);
      if (tier === 'light') {
        meteor = null;
        removeOverlay();
      }
      applySize();
      redrawIfIdle();
    },
    setPointer(p: SkyPointer | null) {
      if (destroyed) return;
      if (!p) {
        if (pointer) {
          pointer = null;
          overlay?.clear();
        }
        return;
      }
      const labels = p.emptySky !== false;
      const moved = !pointer || pointer.x !== p.x || pointer.y !== p.y;
      if (moved || labels !== pointerLabels) {
        if (moved) pointer = { x: p.x, y: p.y };
        pointerLabels = labels;
        // The lines clear at once, and wait for a new rest before they draw again.
        lastMove = performance.now();
        overlay?.clear();
      }
    },
    ripple(x: number, y: number) {
      if (destroyed) return;
      ripple = { x, y, t0: performance.now() };
    },
    start() {
      if (destroyed || failed || still || running) return;
      running = true;
      lastFrameAt = -1;
      fpsSince = -1;
      // A fresh wait for the next meteor: the animation-frame clock kept running while the loop
      // slept, and the old moment has passed.
      nextMeteorAt = 0;
      raf = requestAnimationFrame(frame);
    },
    stop,
    renderStill(timeMs: number) {
      if (destroyed || failed) return;
      draw({ simTime: timeMs, shift: [0, 0], shimmer: null, phase: 0, meteor: null, ripple: null, labels: null });
    },
    destroy() {
      if (destroyed) return;
      stop();
      destroyed = true;
      if (readyRaf) cancelAnimationFrame(readyRaf);
      readyRaf = 0;
      compiling.clear();
      canvas.removeEventListener('webglcontextlost', onContextLost);
      for (const g of [triangle, quad, starGeometry]) g.dispose();
      for (const m of [skyMaterial, milkyWayMaterial, starMaterial, meteorMaterial, groundMaterial]) m.dispose();
      panorama?.dispose();
      // Whatever never reached the GPU (a Whiteprint visit) is freed too.
      closeImage(image);
      scene.clear();
      gl.dispose();
      gl.forceContextLoss();
      removeOverlay();
      canvas.width = 0;
      canvas.height = 0;
      canvas.remove();
      lastDraw = null;
      pointer = null;
      meteor = null;
      ripple = null;
    },
  };
}
