'use client';

/**
 * The engine of the 3D model viewer (ARCHITECTURE.md 13A "ModelViewer"; DESIGN_DIRECTION.md 6.1
 * and 11). ModelViewer.tsx loads this file with next/dynamic only once the viewer may run, so
 * three.js, React Three Fiber, and drei never reach a page's first load.
 *
 * - Realistic: the model's own physically based materials, lit by a procedural room environment
 *   (no file and no CDN), with a contact shadow.
 * - Blueprint: edge lines and silhouettes in the link color on the panel color; the fill hides
 *   hidden edges; the block's callouts are drawn as leaders to labels in the data type.
 * - Thermal: an illustrative shader on the seven ramp stops. The shell shows the caption.
 *
 * Rendering is on demand: a frame is drawn only when something changes, continuously only while
 * the model turns by itself, and never while the tab is hidden or the viewer is out of view.
 */
import { ContactShadows } from '@react-three/drei/core/ContactShadows';
import { OrbitControls } from '@react-three/drei/core/OrbitControls';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
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
  type WheelEvent as ReactWheelEvent,
} from 'react';
import {
  Box3,
  Color,
  NeutralToneMapping,
  PMREMGenerator,
  Spherical,
  SRGBColorSpace,
  TOUCH,
  Vector3,
  type Camera,
  type Group,
  type PerspectiveCamera,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { UI } from '@/lib/strings';
import { cn } from '@/lib/utils';
import { useViewerFrame } from '../shared/ViewerFrame';
import type { ModelView } from '../types';
import { ROTATE_STEP, ZOOM_STEP, type EngineHandle, type EnginePart, type ModelEngineProps } from './engine-types';
import { loadModel } from './loader';
import styles from './ModelViewer.module.css';
import { readPalette, samePalette, type ModelPalette, type Rgb } from './palette';
import { ModelRig } from './rig';

type Controls = ElementRef<typeof OrbitControls>;

const FOV = 35;
/** The starting view: three-quarter, from the front right and a little above. */
const HOME = new Vector3(Math.sin(0.7) * Math.cos(0.38), Math.sin(0.38), Math.cos(0.7) * Math.cos(0.38)).normalize();
const MIN_POLAR = Math.PI * 0.04;
const MAX_POLAR = Math.PI * 0.8;
const MIN_DISTANCE = 0.75;
/** Auto-turn speed in radians per second: one turn in about 21 seconds. */
const AUTO_TURN_SPEED = 0.3;
const TOUCHES = { ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_ROTATE };
const GL_OPTIONS = { antialias: true, alpha: true, powerPreference: 'default', toneMapping: NeutralToneMapping } as const;
const CAMERA = { fov: FOV, near: 0.01, far: 100, position: [0, 0, 4] as [number, number, number] };

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

/** Wheel zoom waits until the visitor engages the viewer, so scrolling the page past it still scrolls. */
interface ZoomGate {
  wanted: boolean;
  apply: (enabled: boolean) => void;
}

/** Distance at which a sphere of radius 1 (the normalized model) fills the view. */
function fitDistance(aspect: number): number {
  const vertical = (FOV * Math.PI) / 180;
  const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * Math.max(aspect, 0.1));
  return 1.02 / Math.sin(Math.min(vertical, horizontal) / 2);
}

function cssColor([r, g, b]: Rgb): string {
  return `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`;
}

export default function ModelEngine({
  src,
  view,
  explode,
  highlight,
  autoTurn,
  running,
  reducedMotion,
  callouts,
  handleRef,
  autoFocus = false,
  onReady,
  onInteract,
  onContextLost,
}: ModelEngineProps) {
  const { isFullscreen, descriptionId } = useViewerFrame();
  const hostRef = useRef<HTMLDivElement>(null);
  const hintId = useId();
  const [gltf, setGltf] = useState<GLTF | null>(null);
  const [failure, setFailure] = useState<Error | null>(null);
  const [palette, setPalette] = useState<ModelPalette | null>(null);
  const [ready, setReady] = useState(false);
  const engaged = useRef(false);
  const zoomGate = useRef<ZoomGate>({ wanted: false, apply: () => undefined });
  const calloutNodes = useRef<CalloutNodes>({ leaders: [], dots: [], labels: [] });

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
    const update = () =>
      setPalette((previous) => {
        const next = readPalette(host);
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
  }, []);

  // After the load or resume button, focus moves here (the button is gone), once per mount.
  const focusOnce = useRef(autoFocus);
  useEffect(() => {
    if (focusOnce.current) hostRef.current?.focus({ preventScroll: true });
    focusOnce.current = false;
  }, []);

  const setZoom = useCallback((enabled: boolean) => {
    zoomGate.current.wanted = enabled;
    zoomGate.current.apply(enabled);
  }, []);

  useEffect(() => {
    setZoom(isFullscreen || engaged.current);
  }, [isFullscreen, setZoom]);

  const handleReady = useCallback(
    (parts: EnginePart[]) => {
      setReady(true);
      onReady(parts);
    },
    [onReady],
  );

  const onPointerDownCapture = () => {
    engaged.current = true;
    setZoom(true);
    onInteract();
  };
  const onPointerLeave = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch') return;
    engaged.current = false;
    setZoom(isFullscreen);
  };
  const onWheelCapture = (event: ReactWheelEvent<HTMLDivElement>) => {
    // A pinch on a trackpad arrives as a wheel event with ctrlKey: always a zoom.
    setZoom(isFullscreen || engaged.current || event.ctrlKey);
  };
  const onFocus = (event: ReactFocusEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    engaged.current = true;
    setZoom(true);
  };
  const onBlur = (event: ReactFocusEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    engaged.current = false;
    setZoom(isFullscreen);
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
        api.zoom(1 / ZOOM_STEP);
        break;
      case '-':
      case '_':
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

  const live = running || isFullscreen;
  const frameloop = live ? (autoTurn ? 'always' : 'demand') : 'never';

  return (
    <>
      <div
        ref={hostRef}
        role="application"
        aria-label={UI.viewers.model.modelFallback}
        aria-describedby={descriptionId ? `${descriptionId} ${hintId}` : hintId}
        tabIndex={ready ? 0 : -1}
        className={cn('absolute inset-0', styles.surface)}
        onPointerDownCapture={onPointerDownCapture}
        onPointerLeave={onPointerLeave}
        onWheelCapture={onWheelCapture}
        onFocus={onFocus}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
      >
        {gltf && palette && (
          <Canvas frameloop={frameloop} dpr={[1, 2]} gl={GL_OPTIONS} camera={CAMERA}>
            <Scene
              gltf={gltf}
              palette={palette}
              view={view}
              explode={explode}
              highlight={highlight}
              autoTurn={autoTurn}
              reducedMotion={reducedMotion}
              fullscreen={isFullscreen}
              live={live}
              calloutCount={callouts.length}
              calloutNodes={calloutNodes}
              handleRef={handleRef}
              zoomGate={zoomGate}
              onReady={handleReady}
              onInteract={onInteract}
              onContextLost={onContextLost}
            />
          </Canvas>
        )}
      </div>
      {callouts.length > 0 && palette && (
        <CalloutLayer callouts={callouts} nodes={calloutNodes} palette={palette} visible={ready && view === 'blueprint'} />
      )}
      <p id={hintId} className="sr-only">
        {UI.viewers.model.keys}
      </p>
    </>
  );
}

interface SceneProps {
  gltf: GLTF;
  palette: ModelPalette;
  view: ModelView;
  explode: number;
  highlight: string | null;
  autoTurn: boolean;
  reducedMotion: boolean;
  fullscreen: boolean;
  live: boolean;
  calloutCount: number;
  calloutNodes: MutableRefObject<CalloutNodes>;
  handleRef: MutableRefObject<EngineHandle | null>;
  zoomGate: MutableRefObject<ZoomGate>;
  onReady: (parts: EnginePart[]) => void;
  onInteract: () => void;
  onContextLost: () => void;
}

function Scene(props: SceneProps) {
  const { gltf, palette, view, explode, highlight, autoTurn, reducedMotion, fullscreen, live } = props;
  const { calloutCount, calloutNodes, handleRef, zoomGate } = props;
  const camera = useThree((state) => state.camera) as PerspectiveCamera;
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const size = useThree((state) => state.size);
  const invalidate = useThree((state) => state.invalidate);
  const get = useThree((state) => state.get);
  // The element the controls listen on; it changes once React Three Fiber connects its events.
  const connected = useThree((state) => state.events.connected) as HTMLElement | undefined;
  const controlsRef = useRef<Controls>(null);
  const shadowRef = useRef<Group>(null);
  const rig = useMemo(() => new ModelRig(gltf.scene), [gltf]);
  const fit = fitDistance(size.width / Math.max(size.height, 1));
  const fitRef = useRef(0);
  const orbit = useMemo(() => ({ spherical: new Spherical(), offset: new Vector3() }), []);
  const box = useMemo(() => new Box3(), []);
  // What the camera frames: the model as it stands, so an exploded model stays in view.
  const framing = useMemo(() => {
    const bounds = rig.currentBox(explode);
    return {
      center: bounds.getCenter(new Vector3()),
      radius: Math.max(bounds.getSize(new Vector3()).length() / 2, 0.05),
      floor: bounds.min.y - 0.002,
    };
  }, [rig, explode]);
  const framingRef = useRef(framing);
  const { floor } = framing;

  // The latest callbacks, without re-running the effects that use them.
  const callbacks = useRef(props);
  callbacks.current = props;
  const autoTurnRef = useRef(autoTurn);
  autoTurnRef.current = autoTurn;

  useEffect(() => () => rig.dispose(), [rig]);

  // The starting view, once per model.
  useLayoutEffect(() => {
    const { center, radius } = framingRef.current;
    const distance = fitDistance(get().size.width / Math.max(get().size.height, 1));
    camera.fov = FOV;
    camera.near = 0.01;
    camera.far = 100;
    camera.updateProjectionMatrix();
    camera.position.copy(HOME).multiplyScalar(distance * radius).add(center);
    camera.lookAt(center);
    controlsRef.current?.target.copy(center);
    controlsRef.current?.update();
    fitRef.current = distance;
    invalidate();
  }, [camera, get, invalidate, rig]);

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
    rig.setResolution(size.width, size.height);
    invalidate();
  }, [camera, fit, invalidate, orbit, rig, size.width, size.height]);

  // A procedural studio environment for the physically based materials (RoomEnvironment).
  useEffect(() => {
    const pmrem = new PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const target = pmrem.fromScene(room, 0.04);
    room.dispose();
    pmrem.dispose();
    scene.environment = target.texture;
    invalidate();
    return () => {
      if (scene.environment === target.texture) scene.environment = null;
      target.dispose();
    };
  }, [gl, scene, invalidate]);

  useLayoutEffect(() => {
    rig.setPalette(palette);
    rig.setView(view);
    rig.setHighlight(highlight);
    scene.background = view === 'blueprint' ? new Color().setRGB(...palette.panel, SRGBColorSpace) : null;
    invalidate();
  }, [rig, palette, view, highlight, scene, invalidate]);

  // Exploding moves the parts, and the camera keeps the whole model in frame at the same zoom.
  useLayoutEffect(() => {
    rig.setExplode(explode);
    const controls = controlsRef.current;
    const previous = framingRef.current;
    if (controls && previous !== framing) {
      const offset = orbit.offset.copy(camera.position).sub(controls.target).multiplyScalar(framing.radius / previous.radius);
      controls.target.copy(framing.center);
      camera.position.copy(framing.center).add(offset);
      controls.update();
    }
    framingRef.current = framing;
    invalidate();
  }, [rig, explode, framing, camera, orbit, invalidate]);

  useLayoutEffect(() => {
    rig.setEnvelope(calloutCount > 0);
    invalidate();
  }, [rig, calloutCount, invalidate]);

  // Changing the frame loop does not restart React Three Fiber's render loop by itself.
  useEffect(() => {
    if (live) invalidate();
  }, [live, autoTurn, invalidate]);

  // Page scrolling wins on touch: one finger drawn sideways orbits, drawn up or down scrolls the
  // page, two fingers pinch and turn. In full screen there is no page to scroll.
  useEffect(() => {
    const element = controlsRef.current?.domElement;
    if (element) element.style.touchAction = fullscreen ? 'none' : 'pan-y';
  }, [fullscreen, connected]);

  useEffect(() => {
    const gate = zoomGate.current;
    gate.apply = (enabled) => {
      if (controlsRef.current) controlsRef.current.enableZoom = enabled;
    };
    gate.apply(gate.wanted);
    return () => {
      gate.apply = () => undefined;
    };
  }, [zoomGate]);

  useEffect(() => {
    const canvas = gl.domElement;
    const lost = () => callbacks.current.onContextLost();
    canvas.addEventListener('webglcontextlost', lost);
    return () => canvas.removeEventListener('webglcontextlost', lost);
  }, [gl]);

  const rotateBy = useCallback(
    (azimuth: number, polar: number) => {
      const controls = controlsRef.current;
      if (!controls) return;
      const { spherical, offset } = orbit;
      offset.copy(camera.position).sub(controls.target);
      spherical.setFromVector3(offset);
      spherical.theta += azimuth;
      spherical.phi = Math.min(MAX_POLAR, Math.max(MIN_POLAR, spherical.phi + polar));
      spherical.makeSafe();
      offset.setFromSpherical(spherical);
      camera.position.copy(controls.target).add(offset);
      camera.lookAt(controls.target);
      controls.update();
      invalidate();
    },
    [camera, invalidate, orbit],
  );

  const zoomBy = useCallback(
    (factor: number) => {
      const controls = controlsRef.current;
      if (!controls) return;
      const { offset } = orbit;
      offset.copy(camera.position).sub(controls.target);
      offset.setLength(Math.min(controls.maxDistance, Math.max(controls.minDistance, offset.length() * factor)));
      camera.position.copy(controls.target).add(offset);
      controls.update();
      invalidate();
    },
    [camera, invalidate, orbit],
  );

  const goHome = useCallback(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    const { size: current } = get();
    const { center, radius } = framingRef.current;
    const distance = fitDistance(current.width / Math.max(current.height, 1));
    // Stop any leftover inertia first, so the view lands exactly home.
    const damping = controls.enableDamping;
    controls.enableDamping = false;
    controls.update();
    controls.target.copy(center);
    camera.position.copy(HOME).multiplyScalar(distance * radius).add(center);
    camera.lookAt(center);
    controls.update();
    controls.enableDamping = damping;
    fitRef.current = distance;
    invalidate();
  }, [camera, get, invalidate]);

  useEffect(() => {
    handleRef.current = { rotate: rotateBy, zoom: zoomBy, reset: goHome };
    return () => {
      handleRef.current = null;
    };
  }, [handleRef, rotateBy, zoomBy, goHome]);

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

  useFrame((state, delta) => {
    if (autoTurnRef.current) rotateBy(Math.min(delta, 0.1) * AUTO_TURN_SPEED, 0);
    // The contact shadow is a floor: hide it when the camera looks from below.
    if (shadowRef.current) shadowRef.current.visible = camera.position.y > floor + 0.01;
    if (view === 'blueprint' && calloutCount > 0) {
      placeCallouts(calloutNodes.current, calloutCount, rig.currentBox(explode, box), state.camera, state.size.width, state.size.height);
    }
  });

  return (
    <>
      <OrbitControls
        ref={controlsRef}
        makeDefault
        enableDamping={!reducedMotion}
        dampingFactor={0.08}
        enablePan={false}
        rotateSpeed={0.85}
        zoomSpeed={0.9}
        minDistance={MIN_DISTANCE}
        maxDistance={fit * 3 * Math.max(1, framing.radius)}
        minPolarAngle={MIN_POLAR}
        maxPolarAngle={MAX_POLAR}
        touches={TOUCHES}
        onStart={() => callbacks.current.onInteract()}
      />
      <primitive object={rig.root} />
      {view === 'realistic' && (
        <ContactShadows
          ref={shadowRef}
          position={[0, floor, 0]}
          scale={4}
          far={1.6}
          blur={2.4}
          opacity={0.5}
          resolution={512}
          frames={1}
        />
      )}
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
    <div className="pointer-events-none absolute inset-0 overflow-hidden" hidden={!visible}>
      <svg className="absolute inset-0 h-full w-full" aria-hidden="true" focusable="false">
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
            className={cn(styles.callout, 'font-mono text-[11px] text-ink')}
            style={{ background: panel, boxShadow: `inset 0 0 0 1px ${line}` }}
          >
            <span className="text-ink-dim">{callout.label}</span> <span className="data">{callout.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
