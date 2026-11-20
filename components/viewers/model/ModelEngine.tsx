'use client';

/**
 * The engine of the 3D model viewers (ARCHITECTURE.md 6 and 13A "ModelViewer"; DESIGN_DIRECTION.md
 * 6.1, 6.3 and 11; motion sheets 4.3, 4.5 and 6.3). ModelViewer.tsx (the 3D block, model covers,
 * the lightbox) and HeroModelViewer.tsx (the hero's model) load this file with next/dynamic only
 * once the viewer may run, so three.js, React Three Fiber, and drei never reach a page's first load.
 *
 * - Realistic: the model's own physically based materials, with a contact shadow drawn again
 *   whenever the model's shape changes (contactShadow.ts). A viewer lights it with a procedural
 *   room (no file and no CDN); the hero lights it with the sky behind it (skyLight.ts, from the
 *   page's sky colors).
 * - Blueprint: edge lines and silhouettes in the line color. In a viewer the solid is filled with
 *   the night over the night well and its grid, and the block's callouts are drawn as leaders; in
 *   the hero the fill writes depth only, so the sky shows through the drawing.
 * - Thermal: an illustrative shader on the seven ramp stops. The shell shows the caption.
 *
 * Motion (every number from lib/motion.ts). Every viewer (sheet 6.3): the model turns 6 degrees a
 * second until first touched; orbit and zoom ease with a damping of 0.08 a frame; pitch stays
 * between 10 degrees below the horizon and 60 above; zoom between 0.6 and 2 times the fitted
 * distance; reset eases home in 600 ms; a view switch copies the old view to an overlay that fades
 * out over the new one in 200 ms. The hero (sheets 4.3 and 4.5): no zoom; 1.5 s after the last
 * input the model eases back to its three-quarter view over 1,200 ms; in the Realistic view the
 * lens shows the Thermal view through a circle (lensPass.ts); RotorL and RotorR tilt 0 to 90
 * degrees with the hero's scroll; it turns only after a tap on phones (the shell's autoTurn).
 * Without motion (useModelMotion.ts) none of that plays: a drag follows with no glide, zoom and
 * reset step at once, views switch at once, the hero stays where it is left with its rotors at
 * hover and no lens.
 *
 * Rendering is on demand: a frame is drawn only when something on the canvas changes, continuously
 * only while the model turns or eases, and never while the tab is hidden or the viewer is out of
 * view. Scrolling the hero draws a frame only when the rotors' tilt changes.
 */
import { OrbitControls } from '@react-three/drei/core/OrbitControls';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import type { MotionValue } from 'motion/react';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ElementRef,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  Box3,
  NeutralToneMapping,
  PMREMGenerator,
  Spherical,
  TOUCH,
  Vector3,
  type Camera,
  type PerspectiveCamera,
  type WebGLRenderTarget,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { cssEasing, hero as heroMotion, media, toMs, type Bezier } from '@/lib/motion';
import { UI } from '@/lib/strings';
import type { ModelView } from '../types';
import {
  ROTATE_STEP,
  WHEEL_ZOOM_STEP,
  ZOOM_STEP,
  type EngineHandle,
  type EnginePart,
  type HeroEngineInputs,
  type ModelEngineProps,
} from './engine-types';
import { ContactShadow } from './contactShadow';
import { LensPass } from './lensPass';
import { loadModel } from './loader';
import styles from './ModelViewer.module.css';
import {
  AUTO_TURN,
  FOV,
  HERO_TURN,
  HOME_PHI,
  HOME_THETA,
  IdleReturn,
  POLAR_MAX,
  POLAR_MIN,
  blendOrbit,
  clampZoom,
  easing,
  heroRotorTilt,
  posterFitDistance,
  sameOrbit,
  type OrbitState,
} from './orbit';
import { readPalette, samePalette, type ModelPalette, type Rgb } from './palette';
import { ModelRig } from './rig';
import { createSkyEnvironment } from './skyLight';

type Controls = ElementRef<typeof OrbitControls>;

/** The starting view, as a direction from the model's centre: three-quarter, from the front right and a little above. */
const HOME = new Vector3().setFromSphericalCoords(1, HOME_PHI, HOME_THETA);
const TOUCHES = { ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_ROTATE };
const GL_OPTIONS = { antialias: true, alpha: true, powerPreference: 'default', toneMapping: NeutralToneMapping } as const;
const CAMERA = { fov: FOV, near: 0.01, far: 100, position: [0, 0, 4] as [number, number, number] };
/**
 * The canvas is measured when it resizes, not when the page scrolls. React Three Fiber measures it
 * again after every scroll by default, for its own pointer events (which this engine does not use,
 * and which read offsetX and offsetY anyway), and every new measure draws a frame.
 */
const RESIZE = { scroll: false } as const;
/** A zoom within this share of its target has arrived. */
const ZOOM_SETTLED = 1e-4;
/** Below this opacity the lens draws nothing. */
const LENS_HIDDEN = 0.001;

/** Where callout labels sit, in order: right top, left bottom, left top, right bottom, then the middles. */
const CALLOUT_SLOTS: { side: 'left' | 'right'; y: number }[] = [
  { side: 'right', y: 0.16 },
  { side: 'left', y: 0.84 },
  { side: 'left', y: 0.16 },
  { side: 'right', y: 0.84 },
  { side: 'right', y: 0.5 },
  { side: 'left', y: 0.5 },
];

interface CalloutNodes {
  leaders: (SVGPolylineElement | null)[];
  dots: (SVGCircleElement | null)[];
  labels: (HTMLLIElement | null)[];
}

/** What the camera frames: the model as it stands, so an exploded model stays in view. */
interface Framing {
  center: Vector3;
  radius: number;
  floor: number;
}

/** The camera easing home (reset, or the hero's return), from where it was. */
interface Tween {
  start: number;
  duration: number;
  ease: (t: number) => number;
  from: OrbitState;
}

function framingOf(rig: ModelRig, amount: number): Framing {
  const bounds = rig.currentBox(amount);
  return {
    center: bounds.getCenter(new Vector3()),
    radius: Math.max(bounds.getSize(new Vector3()).length() / 2, 0.05),
    floor: bounds.min.y - 0.002,
  };
}

function cssColor([r, g, b]: Rgb): string {
  return `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`;
}

/** The distance between the first two touches, or 0 with fewer than two. */
function spanOf(points: Map<number, { x: number; y: number }>): number {
  if (points.size < 2) return 0;
  const [a, b] = points.values();
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Copies the frame just drawn on the WebGL canvas to the overlay; false when it cannot. */
function copyFrame(source: HTMLCanvasElement, overlay: HTMLCanvasElement): boolean {
  if (source.width === 0 || source.height === 0) return false;
  const context = overlay.getContext('2d');
  if (!context) return false;
  if (overlay.width !== source.width) overlay.width = source.width;
  if (overlay.height !== source.height) overlay.height = source.height;
  context.clearRect(0, 0, overlay.width, overlay.height);
  context.drawImage(source, 0, 0);
  return true;
}

/** Fades the overlay (resting at opacity 0) out from full over the new view. */
function fadeOut(overlay: HTMLCanvasElement, duration: number, curve: Bezier): void {
  if (typeof overlay.animate !== 'function') return;
  overlay.getAnimations?.().forEach((animation) => animation.cancel());
  overlay.animate([{ opacity: 1 }, { opacity: 0 }], { duration: toMs(duration), easing: cssEasing(curve) });
}

export default function ModelEngine({
  src,
  view,
  explode,
  highlight,
  autoTurn,
  running,
  motion,
  fullscreen,
  descriptionId,
  callouts,
  handleRef,
  autoFocus = false,
  onReady,
  onInteract,
  onContextLost,
  hero,
}: ModelEngineProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const hintId = useId();
  const [gltf, setGltf] = useState<GLTF | null>(null);
  const [failure, setFailure] = useState<Error | null>(null);
  const [palette, setPalette] = useState<ModelPalette | null>(null);
  const [ready, setReady] = useState(false);
  /** The visitor pressed or focused the viewer: the wheel zooms instead of scrolling the page. */
  const engaged = useRef(false);
  const fullscreenRef = useRef(fullscreen);
  fullscreenRef.current = fullscreen;
  const onInteractRef = useRef(onInteract);
  onInteractRef.current = onInteract;
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinchSpan = useRef(0);
  const calloutNodes = useRef<CalloutNodes>({ leaders: [], dots: [], labels: [] });
  const isHero = hero !== undefined;
  const zoomable = !isHero;

  useEffect(() => {
    let live = true;
    loadModel(src).then(
      (result) => {
        if (live) setGltf(result);
      },
      (error: unknown) => {
        if (live) setFailure(error instanceof Error ? error : new Error('Model load failed'));
      },
    );
    return () => {
      live = false;
    };
  }, [src]);

  // Colors come from the page's CSS, and follow the theme toggle.
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const surface = isHero ? 'page' : 'night';
    const update = () =>
      setPalette((previous) => {
        const next = readPalette(host, surface);
        return samePalette(previous, next) ? previous : next;
      });
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
    const scheme = window.matchMedia('(prefers-color-scheme: dark)');
    scheme.addEventListener('change', update);
    return () => {
      observer.disconnect();
      scheme.removeEventListener('change', update);
    };
  }, [isHero]);

  // After the load or resume button, focus moves here (the button is gone), once per mount.
  const focusOnce = useRef(autoFocus);
  useEffect(() => {
    if (focusOnce.current) hostRef.current?.focus({ preventScroll: true });
    focusOnce.current = false;
  }, []);

  // The wheel zooms a viewer (never the hero) once the visitor engages it, in full screen, or as a
  // trackpad pinch (a wheel event with ctrlKey); otherwise the page scrolls past it. A native
  // listener, because only a non-passive one may keep the page from scrolling.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !zoomable) return undefined;
    const onWheel = (event: WheelEvent) => {
      if (event.deltaY === 0 || !(engaged.current || fullscreenRef.current || event.ctrlKey)) return;
      const api = handleRef.current;
      if (!api) return;
      event.preventDefault();
      api.zoom(event.deltaY < 0 ? WHEEL_ZOOM_STEP : 1 / WHEEL_ZOOM_STEP);
      onInteractRef.current();
    };
    host.addEventListener('wheel', onWheel, { passive: false });
    return () => host.removeEventListener('wheel', onWheel);
  }, [handleRef, zoomable]);

  const handleReady = useCallback(
    (parts: EnginePart[]) => {
      setReady(true);
      onReady(parts);
    },
    [onReady],
  );

  const onPointerDownCapture = (event: ReactPointerEvent<HTMLDivElement>) => {
    engaged.current = true;
    onInteract();
    if (zoomable && event.pointerType === 'touch') {
      touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      pinchSpan.current = spanOf(touches.current);
    }
  };
  // Two fingers pinch the zoom (one finger drawn sideways orbits; up or down scrolls the page).
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!zoomable || event.pointerType !== 'touch' || !touches.current.has(event.pointerId)) return;
    touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const span = spanOf(touches.current);
    const api = handleRef.current;
    if (api && span > 0 && pinchSpan.current > 0) api.zoom(pinchSpan.current / span);
    pinchSpan.current = span;
  };
  const onTouchEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'touch') return;
    touches.current.delete(event.pointerId);
    pinchSpan.current = spanOf(touches.current);
  };
  const onPointerLeave = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'touch') engaged.current = false;
  };
  const onFocus = (event: ReactFocusEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) engaged.current = true;
  };
  const onBlur = (event: ReactFocusEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) engaged.current = false;
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey) return;
    const api = handleRef.current;
    if (!api) return;
    const step = event.shiftKey ? ROTATE_STEP * 3 : ROTATE_STEP;
    switch (event.key) {
      case 'ArrowLeft':
        api.rotate(step, 0);
        break;
      case 'ArrowRight':
        api.rotate(-step, 0);
        break;
      case 'ArrowUp':
        api.rotate(0, step);
        break;
      case 'ArrowDown':
        api.rotate(0, -step);
        break;
      case '+':
      case '=':
        if (!zoomable) return;
        api.zoom(1 / ZOOM_STEP);
        break;
      case '-':
      case '_':
        if (!zoomable) return;
        api.zoom(ZOOM_STEP);
        break;
      default:
        return;
    }
    event.preventDefault();
    onInteract();
  };

  // An error thrown here reaches the shell's error boundary: poster, message, no engine.
  if (failure) throw failure;

  const live = running || fullscreen;
  const frameloop = live ? (autoTurn ? 'always' : 'demand') : 'never';

  return (
    <>
      <div
        ref={hostRef}
        role="application"
        aria-label={UI.viewers.model.modelFallback}
        aria-describedby={descriptionId ? `${descriptionId} ${hintId}` : hintId}
        tabIndex={ready ? 0 : -1}
        className={styles.surface}
        onPointerDownCapture={onPointerDownCapture}
        onPointerMove={onPointerMove}
        onPointerUp={onTouchEnd}
        onPointerCancel={onTouchEnd}
        onPointerLeave={onPointerLeave}
        onFocus={onFocus}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
      >
        {gltf && palette && (
          <Canvas frameloop={frameloop} dpr={[1, 2]} gl={GL_OPTIONS} camera={CAMERA} resize={RESIZE}>
            <Scene
              gltf={gltf}
              palette={palette}
              view={view}
              explode={explode}
              highlight={highlight}
              autoTurn={autoTurn}
              motion={motion}
              fullscreen={fullscreen}
              live={live}
              hero={hero}
              calloutCount={callouts.length}
              calloutNodes={calloutNodes}
              handleRef={handleRef}
              overlayRef={overlayRef}
              onReady={handleReady}
              onInteract={onInteract}
              onContextLost={onContextLost}
            />
          </Canvas>
        )}
        {/* The old view during a switch: a copy of its last frame, fading out over the new one. */}
        <canvas ref={overlayRef} className={styles.overlay} aria-hidden="true" />
      </div>
      {callouts.length > 0 && palette && (
        <CalloutLayer callouts={callouts} nodes={calloutNodes} palette={palette} visible={ready && view === 'blueprint'} />
      )}
      <p id={hintId} className="ar-sr">
        {zoomable ? UI.viewers.model.keys : UI.viewers.model.keysRotate}
      </p>
    </>
  );
}

interface SceneProps {
  gltf: GLTF;
  palette: ModelPalette;
  view: ModelView;
  explode: MotionValue<number>;
  highlight: string | null;
  autoTurn: boolean;
  motion: boolean;
  fullscreen: boolean;
  live: boolean;
  hero?: HeroEngineInputs;
  calloutCount: number;
  calloutNodes: MutableRefObject<CalloutNodes>;
  handleRef: MutableRefObject<EngineHandle | null>;
  overlayRef: MutableRefObject<HTMLCanvasElement | null>;
  onReady: (parts: EnginePart[]) => void;
  onInteract: () => void;
  onContextLost: () => void;
}

function Scene(props: SceneProps) {
  const { gltf, palette, view, explode, highlight, autoTurn, motion, fullscreen, live, hero } = props;
  const { calloutCount, calloutNodes, handleRef, overlayRef } = props;
  const camera = useThree((state) => state.camera) as PerspectiveCamera;
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const size = useThree((state) => state.size);
  const invalidate = useThree((state) => state.invalidate);
  const get = useThree((state) => state.get);
  // The element the controls listen on; it changes once React Three Fiber connects its events.
  const connected = useThree((state) => state.events.connected) as HTMLElement | undefined;
  const controlsRef = useRef<Controls>(null);
  const isHero = hero !== undefined;
  const posterAspect = hero?.posterAspect;
  const rig = useMemo(() => new ModelRig(gltf.scene, { fill: isHero ? 'depth' : 'night' }), [gltf, isHero]);
  const lensPass = useMemo(() => (isHero ? new LensPass() : null), [isHero]);
  const shadow = useMemo(() => new ContactShadow(), []);
  const fit = posterFitDistance(FOV, size.width / Math.max(size.height, 1), posterAspect);
  const orbit = useMemo(() => ({ spherical: new Spherical(), offset: new Vector3() }), []);
  const box = useMemo(() => new Box3(), []);
  // The framing when the model arrives (the starting view below sets it again); later changes move
  // the camera and the shadow directly.
  const initialFraming = useMemo(() => framingOf(rig, explode.get()), [rig, explode]);

  const fitRef = useRef(0);
  const framingRef = useRef(initialFraming);
  const explodeRef = useRef(explode.get());
  /** The zoom the camera eases toward, as a share of the fitted distance (sheet 6.3: 0.6 to 2). */
  const zoomRef = useRef(1);
  const tweenRef = useRef<Tween | null>(null);
  const drawnRef = useRef(false);
  const shownRef = useRef<{ rig: ModelRig; view: ModelView } | null>(null);
  const motionRef = useRef(motion);
  motionRef.current = motion;
  const liveRef = useRef(live);
  liveRef.current = live;
  const autoTurnRef = useRef(autoTurn);
  autoTurnRef.current = autoTurn;
  // The latest callbacks, without re-running the effects that use them.
  const callbacks = useRef(props);
  callbacks.current = props;

  useEffect(() => () => rig.dispose(), [rig]);
  useEffect(() => () => lensPass?.dispose(), [lensPass]);
  useEffect(() => () => shadow.dispose(), [shadow]);

  /** Sheet 6.3: the camera stays between 0.6 and 2 times the fitted distance. */
  const applyLimits = useCallback(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    const fitted = fitRef.current * framingRef.current.radius;
    controls.minDistance = fitted * media.model.zoomMin;
    controls.maxDistance = fitted * media.model.zoomMax;
  }, []);

  // The starting view, once per model.
  useLayoutEffect(() => {
    const amount = explode.get();
    rig.setExplode(amount);
    explodeRef.current = amount;
    framingRef.current = framingOf(rig, amount);
    shadow.setFloor(framingRef.current.floor);
    shadow.markDirty();
    zoomRef.current = 1;
    tweenRef.current = null;
    drawnRef.current = false;
    const { center, radius } = framingRef.current;
    const current = get().size;
    const distance = posterFitDistance(FOV, current.width / Math.max(current.height, 1), posterAspect);
    camera.fov = FOV;
    camera.near = 0.01;
    camera.far = 100;
    camera.updateProjectionMatrix();
    camera.position.copy(HOME).multiplyScalar(distance * radius).add(center);
    camera.lookAt(center);
    fitRef.current = distance;
    const controls = controlsRef.current;
    if (controls) {
      controls.target.copy(center);
      controls.update();
    }
    applyLimits();
    invalidate();
  }, [applyLimits, camera, explode, get, invalidate, posterAspect, rig, shadow]);

  // On resize (full screen, rotation), keep the same framing relative to the new fit.
  useEffect(() => {
    const controls = controlsRef.current;
    const previous = fitRef.current;
    if (controls && previous > 0 && Math.abs(previous - fit) > 1e-6) {
      const offset = orbit.offset.copy(camera.position).sub(controls.target).multiplyScalar(fit / previous);
      camera.position.copy(controls.target).add(offset);
      controls.update();
    }
    fitRef.current = fit;
    applyLimits();
    rig.setResolution(size.width, size.height);
    invalidate();
  }, [applyLimits, camera, fit, invalidate, orbit, rig, size.width, size.height]);

  // The light for the physically based materials: the sky behind the hero, a procedural studio in
  // a viewer (RoomEnvironment).
  const sky = palette.sky;
  useEffect(() => {
    let target: WebGLRenderTarget;
    if (isHero && sky) {
      target = createSkyEnvironment(gl, sky);
    } else {
      const pmrem = new PMREMGenerator(gl);
      const room = new RoomEnvironment();
      target = pmrem.fromScene(room, 0.04);
      room.dispose();
      pmrem.dispose();
    }
    scene.environment = target.texture;
    invalidate();
    return () => {
      if (scene.environment === target.texture) scene.environment = null;
      target.dispose();
    };
  }, [gl, scene, invalidate, isHero, sky]);

  useLayoutEffect(() => {
    rig.setPalette(palette);
    rig.setHighlight(highlight);
    // Every view sits on the night well and its grid, or on the page in the hero; the canvas
    // itself stays clear.
    scene.background = null;
    invalidate();
  }, [rig, palette, highlight, scene, invalidate]);

  useLayoutEffect(() => {
    rig.setEnvelope(calloutCount > 0);
    invalidate();
  }, [rig, calloutCount, invalidate]);

  // Exploding moves the parts, and the camera keeps the whole model in frame at the same zoom. The
  // slider sets the amount at once and the arrow keys ease it (ModelViewer.tsx), so this follows
  // the motion value, never a React render.
  const applyExplode = useCallback(
    (amount: number) => {
      explodeRef.current = amount;
      rig.setExplode(amount);
      const next = framingOf(rig, amount);
      const previous = framingRef.current;
      const controls = controlsRef.current;
      if (controls && previous.radius > 0) {
        const offset = orbit.offset.copy(camera.position).sub(controls.target).multiplyScalar(next.radius / previous.radius);
        controls.target.copy(next.center);
        camera.position.copy(next.center).add(offset);
        controls.update();
      }
      framingRef.current = next;
      // The parts moved: the shadow follows them to the new floor and is drawn again.
      shadow.setFloor(next.floor);
      shadow.markDirty();
      applyLimits();
      invalidate();
    },
    [applyLimits, camera, invalidate, orbit, rig, shadow],
  );
  useEffect(() => explode.on('change', applyExplode), [explode, applyExplode]);

  // The hero's rotors follow its scroll (sheet 4.3). A frame only when the tilt they should show
  // differs from the one drawn: a model without RotorL and RotorR, reduced motion or the pause
  // control (the tilt held at hover), and a scroll that leaves the tilt as it is draw nothing.
  const hasRotors = rig.rotors.length > 0;
  useEffect(() => {
    if (!hero || !hasRotors) return undefined;
    return hero.rotor.on('change', (progress) => {
      if (heroRotorTilt(progress, motionRef.current) !== rig.rotorAngle) invalidate();
    });
  }, [hasRotors, hero, invalidate, rig]);

  // The lens moves with motion values: a change asks for one frame while the lens can show (the
  // Realistic view, with motion). Its fade out after a view switch or a pause draws nothing.
  useEffect(() => {
    if (!hero) return undefined;
    const { x, y, radius, opacity } = hero.lens;
    const stops = [x, y, radius, opacity].map((value) =>
      value.on('change', () => {
        if (motionRef.current && rig.currentView === 'realistic') invalidate();
      }),
    );
    return () => stops.forEach((stop) => stop());
  }, [hero, invalidate, rig]);

  // Changing the frame loop does not restart React Three Fiber's render loop by itself.
  useEffect(() => {
    if (live) invalidate();
  }, [live, autoTurn, motion, invalidate]);

  // Page scrolling wins on touch: one finger drawn sideways orbits, drawn up or down scrolls the
  // page. A viewer takes two fingers for its own pinch; the hero leaves the pinch to the page.
  // In full screen there is no page to scroll.
  useEffect(() => {
    const element = controlsRef.current?.domElement;
    if (element) element.style.touchAction = fullscreen ? 'none' : isHero ? 'pan-y pinch-zoom' : 'pan-y';
  }, [fullscreen, connected, isHero]);

  useEffect(() => {
    const canvas = gl.domElement;
    const lost = () => callbacks.current.onContextLost();
    canvas.addEventListener('webglcontextlost', lost);
    return () => canvas.removeEventListener('webglcontextlost', lost);
  }, [gl]);

  /** Where the camera is now, about the point it looks at. */
  const readOrbit = useCallback((): OrbitState | null => {
    const controls = controlsRef.current;
    if (!controls) return null;
    const { spherical, offset } = orbit;
    spherical.setFromVector3(offset.copy(camera.position).sub(controls.target));
    return {
      theta: spherical.theta,
      phi: spherical.phi,
      radius: spherical.radius,
      target: [controls.target.x, controls.target.y, controls.target.z],
    };
  }, [camera, orbit]);

  /** The three-quarter view at the fitted distance, for the model as it stands. */
  const homeOrbit = useCallback((): OrbitState => {
    const { center, radius } = framingRef.current;
    return { theta: HOME_THETA, phi: HOME_PHI, radius: fitRef.current * radius, target: [center.x, center.y, center.z] };
  }, []);

  const placeCamera = useCallback(
    (state: OrbitState) => {
      const controls = controlsRef.current;
      if (!controls) return;
      const { spherical, offset } = orbit;
      spherical.set(state.radius, state.phi, state.theta);
      offset.setFromSpherical(spherical);
      controls.target.set(state.target[0], state.target[1], state.target[2]);
      camera.position.copy(controls.target).add(offset);
      camera.lookAt(controls.target);
    },
    [camera, orbit],
  );

  /** Ends any glide left from a drag, so an ease or a jump starts from rest. */
  const stopGlide = useCallback(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    const damping = controls.enableDamping;
    controls.enableDamping = false;
    controls.update();
    controls.enableDamping = damping;
  }, []);

  /** Eases the camera home over `duration` seconds on `curve` (reset, and the hero's return). */
  const startTween = useCallback(
    (duration: number, curve: Bezier) => {
      stopGlide();
      zoomRef.current = 1;
      const from = readOrbit();
      tweenRef.current = from && !sameOrbit(from, homeOrbit()) ? { start: performance.now(), duration: toMs(duration), ease: easing(curve), from } : null;
      invalidate();
    },
    [homeOrbit, invalidate, readOrbit, stopGlide],
  );

  /** Without motion, reset is a jump home. */
  const jumpHome = useCallback(() => {
    stopGlide();
    tweenRef.current = null;
    zoomRef.current = 1;
    placeCamera(homeOrbit());
    controlsRef.current?.update();
    invalidate();
  }, [homeOrbit, invalidate, placeCamera, stopGlide]);

  // Sheet 4.5: the hero goes back to its three-quarter view 1.5 s after the last input.
  const startTweenRef = useRef(startTween);
  startTweenRef.current = startTween;
  const idleReturn = useMemo(
    () =>
      new IdleReturn(() => {
        if (motionRef.current) startTweenRef.current(heroMotion.model.returnDuration, heroMotion.model.returnEase);
      }),
    [],
  );
  useEffect(() => () => idleReturn.cancel(), [idleReturn]);
  useEffect(() => {
    if (!motion) idleReturn.cancel();
  }, [idleReturn, motion]);

  const rotateBy = useCallback(
    (azimuth: number, polar: number) => {
      const controls = controlsRef.current;
      if (!controls) return;
      const { spherical, offset } = orbit;
      offset.copy(camera.position).sub(controls.target);
      spherical.setFromVector3(offset);
      spherical.theta += azimuth;
      spherical.phi = Math.min(POLAR_MAX, Math.max(POLAR_MIN, spherical.phi + polar));
      spherical.makeSafe();
      offset.setFromSpherical(spherical);
      camera.position.copy(controls.target).add(offset);
      camera.lookAt(controls.target);
      controls.update();
      invalidate();
    },
    [camera, invalidate, orbit],
  );

  const setDistance = useCallback(
    (distance: number) => {
      const controls = controlsRef.current;
      if (!controls) return;
      orbit.offset.copy(camera.position).sub(controls.target).setLength(distance);
      camera.position.copy(controls.target).add(orbit.offset);
    },
    [camera, orbit],
  );

  /** Sheet 6.3: the zoom target moves at once, the camera eases to it (each frame, below). */
  const zoomBy = useCallback(
    (factor: number) => {
      if (isHero) return;
      tweenRef.current = null;
      zoomRef.current = clampZoom(zoomRef.current * factor);
      if (!motionRef.current) {
        setDistance(zoomRef.current * fitRef.current * framingRef.current.radius);
        controlsRef.current?.update();
      }
      invalidate();
    },
    [invalidate, isHero, setDistance],
  );

  useEffect(() => {
    handleRef.current = {
      rotate: (azimuth, polar) => {
        tweenRef.current = null;
        idleReturn.cancel();
        rotateBy(azimuth, polar);
        if (isHero) idleReturn.schedule(motionRef.current);
      },
      zoom: zoomBy,
      reset: () => (motionRef.current ? startTween(media.model.reset.duration, media.model.reset.ease) : jumpHome()),
    };
    return () => {
      handleRef.current = null;
    };
  }, [handleRef, idleReturn, isHero, jumpHome, rotateBy, startTween, zoomBy]);

  /**
   * One frame: the model as the view shows it, then, in the hero's Realistic view, the lens. The
   * view switch below draws the old view with this before it copies it.
   */
  const drawFrame = useCallback(() => {
    // The contact shadow is a floor under the Realistic view: hidden from below and in the other
    // views, and drawn again first when the model's shape has changed since it was last drawn.
    shadow.root.visible = rig.currentView === 'realistic' && camera.position.y > framingRef.current.floor + 0.01;
    if (shadow.root.visible) shadow.update(gl, scene);
    gl.render(scene, camera);
    if (!lensPass || !hero || !motionRef.current || rig.currentView !== 'realistic') return;
    const alpha = hero.lens.opacity.get();
    if (!(alpha > LENS_HIDDEN)) return;
    const lens = { x: hero.lens.x.get(), y: hero.lens.y.get(), radius: hero.lens.radius.get(), alpha };
    lensPass.render(gl, camera, lens, get().size, () => rig.withView('thermal', () => gl.render(rig.root, camera)));
  }, [camera, get, gl, hero, lensPass, rig, scene, shadow]);

  // A view switch (sheets 4.5 and 6.3): the old view's last frame is copied to an overlay that
  // fades out over the new one; the switch itself is at once. Without motion: at once.
  useLayoutEffect(() => {
    const shown = shownRef.current;
    if (shown && shown.rig === rig && shown.view === view) return;
    const overlay = overlayRef.current;
    if (shown && shown.rig === rig && motionRef.current && drawnRef.current && liveRef.current && overlay) {
      drawFrame();
      if (copyFrame(gl.domElement, overlay)) {
        const fade = isHero ? { duration: heroMotion.model.viewFade, ease: heroMotion.model.viewEase } : media.model.viewFade;
        fadeOut(overlay, fade.duration, fade.ease);
      }
    }
    rig.setView(view);
    shownRef.current = { rig, view };
    invalidate();
  }, [drawFrame, gl, invalidate, isHero, overlayRef, rig, view]);

  // Tell the shell once the first frame with the model is on screen.
  useEffect(() => {
    invalidate();
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => callbacks.current.onReady(rig.parts.map(({ id, name }) => ({ id, name }))));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [rig, invalidate]);

  // Priority 1: this callback draws the frame itself (after drei's controls update at -1).
  useFrame((state, delta) => {
    const controls = controlsRef.current;
    let again = false;
    const tween = tweenRef.current;
    if (tween && controls) {
      const t = Math.min(1, (performance.now() - tween.start) / tween.duration);
      placeCamera(blendOrbit(tween.from, homeOrbit(), tween.ease(t)));
      if (t < 1) {
        again = true;
      } else {
        tweenRef.current = null;
        controls.update();
      }
    } else if (controls) {
      if (autoTurnRef.current) rotateBy(Math.min(delta, 0.1) * (isHero ? HERO_TURN : AUTO_TURN), 0);
      // The zoom eases toward its target by the orbit's own damping, a share of the gap a frame.
      const desired = zoomRef.current * fitRef.current * framingRef.current.radius;
      const current = camera.position.distanceTo(controls.target);
      const gap = desired - current;
      if (Math.abs(gap) > desired * ZOOM_SETTLED) {
        setDistance(motionRef.current ? current + gap * media.model.damping : desired);
        again = true;
      }
    }
    if (hero && rig.setRotorTilt(heroRotorTilt(hero.rotor.get(), motionRef.current))) shadow.markDirty();
    if (rig.currentView === 'blueprint' && calloutCount > 0) {
      placeCallouts(calloutNodes.current, calloutCount, rig.currentBox(explodeRef.current, box), state.camera, state.size.width, state.size.height);
    }
    drawFrame();
    drawnRef.current = true;
    if (again) invalidate();
  }, 1);

  return (
    <>
      <OrbitControls
        ref={controlsRef}
        makeDefault
        enableDamping={motion}
        dampingFactor={media.model.damping}
        enablePan={false}
        enableZoom={false}
        rotateSpeed={0.85}
        minPolarAngle={POLAR_MIN}
        maxPolarAngle={POLAR_MAX}
        touches={TOUCHES}
        onStart={() => {
          tweenRef.current = null;
          idleReturn.cancel();
          callbacks.current.onInteract();
        }}
        onEnd={() => {
          if (isHero) idleReturn.schedule(motionRef.current);
        }}
      />
      <primitive object={rig.root} />
      <primitive object={shadow.root} />
    </>
  );
}

const corner = new Vector3();
const projected = Array.from({ length: 8 }, () => ({ x: 0, y: 0, visible: false }));

/**
 * Places each callout label in a fixed slot at the left or right edge of the canvas, with a
 * leader from the nearest free corner of the model's bounding box. Called on every drawn frame
 * of the Blueprint view; it writes the DOM directly, without a React render.
 */
function placeCallouts(nodes: CalloutNodes, count: number, bounds: Box3, camera: Camera, width: number, height: number) {
  for (let k = 0; k < 8; k += 1) {
    corner
      .set(k & 1 ? bounds.max.x : bounds.min.x, k & 2 ? bounds.max.y : bounds.min.y, k & 4 ? bounds.max.z : bounds.min.z)
      .project(camera);
    projected[k].x = ((corner.x + 1) / 2) * width;
    projected[k].y = ((1 - corner.y) / 2) * height;
    projected[k].visible = corner.z > -1 && corner.z < 1;
  }
  const used = new Set<number>();
  for (let i = 0; i < count; i += 1) {
    const label = nodes.labels[i];
    const leader = nodes.leaders[i];
    const dot = nodes.dots[i];
    if (!label || !leader || !dot) continue;
    const slot = CALLOUT_SLOTS[i % CALLOUT_SLOTS.length];
    const row = Math.floor(i / CALLOUT_SLOTS.length);
    const labelWidth = label.offsetWidth;
    const labelHeight = label.offsetHeight;
    const step = (labelHeight + 6) * row * (slot.y > 0.5 ? -1 : 1);
    const y = Math.min(height - labelHeight / 2 - 6, Math.max(labelHeight / 2 + 6, slot.y * height + step));
    const x = slot.side === 'right' ? width - 10 - labelWidth : 10;
    const near = slot.side === 'right' ? x : x + labelWidth;
    let best = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    projected.forEach((point, k) => {
      if (!point.visible || used.has(k)) return;
      const distance = (point.x - near) ** 2 + (point.y - y) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = k;
      }
    });
    if (best < 0) {
      label.style.visibility = 'hidden';
      leader.setAttribute('visibility', 'hidden');
      dot.setAttribute('visibility', 'hidden');
      continue;
    }
    used.add(best);
    const anchor = projected[best];
    // The leader meets the label on the edge that faces its anchor, with a short shoulder.
    const left = x;
    const right = x + labelWidth;
    const points: [number, number][] = [[anchor.x, anchor.y]];
    if (anchor.x < left - 8) points.push([left - 14, y], [left, y]);
    else if (anchor.x > right + 8) points.push([right + 14, y], [right, y]);
    else points.push([Math.min(right - 8, Math.max(left + 8, anchor.x)), anchor.y < y ? y - labelHeight / 2 : y + labelHeight / 2]);
    leader.setAttribute('points', points.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(' '));
    dot.setAttribute('cx', anchor.x.toFixed(1));
    dot.setAttribute('cy', anchor.y.toFixed(1));
    label.style.transform = `translate(${x.toFixed(1)}px, ${(y - labelHeight / 2).toFixed(1)}px)`;
    label.style.visibility = 'visible';
    leader.removeAttribute('visibility');
    dot.removeAttribute('visibility');
  }
}

/** The Blueprint callouts: leaders in an SVG layer, labels as real text the page can read. */
function CalloutLayer({
  callouts,
  nodes,
  palette,
  visible,
}: {
  callouts: { label: string; value: string }[];
  nodes: MutableRefObject<CalloutNodes>;
  palette: ModelPalette;
  visible: boolean;
}) {
  const line = cssColor(palette.line);
  const panel = cssColor(palette.panel);
  return (
    <div className={styles.callouts} hidden={!visible}>
      <svg className={styles.leaders} aria-hidden="true" focusable="false">
        {callouts.map((callout, i) => (
          <g key={`${callout.label}-${i}`}>
            <polyline
              ref={(element) => {
                nodes.current.leaders[i] = element;
              }}
              className={styles.leader}
              style={{ stroke: line }}
              visibility="hidden"
            />
            <circle
              ref={(element) => {
                nodes.current.dots[i] = element;
              }}
              r={2.5}
              style={{ fill: line }}
              visibility="hidden"
            />
          </g>
        ))}
      </svg>
      <ul aria-label={UI.projects.callouts}>
        {callouts.map((callout, i) => (
          <li
            key={`${callout.label}-${i}`}
            ref={(element) => {
              nodes.current.labels[i] = element;
            }}
            className={styles.callout}
            style={{ background: panel, boxShadow: `inset 0 0 0 1px ${line}` }}
          >
            <span className={styles.calloutLabel}>{callout.label}</span> <span>{callout.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
