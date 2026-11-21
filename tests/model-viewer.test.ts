/**
 * The model viewers' motion (motion sheets 4.3, 4.5 and 6.3; lib/motion.ts `hero` and `media`):
 * the geometry and timing in components/viewers/model/orbit.ts, the rig's rotor tilt, exploded
 * view, and Blueprint fill on a real GLB (tests/fixtures/rotor-model.ts, read by three.js's own
 * loader under Node), when the contact shadow is drawn again, and the hero's server-side resolve.
 * The WebGL drawing itself (the engine, the lens pass, the sky light) needs a browser; the Phase 5
 * browser check covers it. The hero's shell is in tests/model-hero.test.ts.
 */
import { isValidElement, type ReactElement } from 'react';
import {
  Box3,
  Mesh,
  MeshBasicMaterial,
  MeshDepthMaterial,
  Quaternion,
  Scene,
  ShaderMaterial,
  Vector3,
  type Material,
  type Object3D,
  type WebGLRenderer,
} from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import HeroModel, { heroModelMedia } from '@/components/home/hero/HeroModel';
import { ContactShadow, SHADOW } from '@/components/viewers/model/contactShadow';
import HeroModelLazy from '@/components/viewers/model/HeroModelLazy';
import {
  AUTO_TURN,
  HERO_TURN,
  HINT_FADE_VARS,
  HOME_PHI,
  HOME_THETA,
  IdleReturn,
  POLAR_MAX,
  POLAR_MIN,
  blendOrbit,
  clampLensCenter,
  clampZoom,
  easing,
  explodeOffset,
  fitDistance,
  heroRotorTilt,
  heroScrollProgress,
  lensRadius,
  lensSquare,
  posterFitDistance,
  rotorTilt,
  sameOrbit,
  shortestTurn,
  stepExplode,
  type OrbitState,
  type Timers,
} from '@/components/viewers/model/orbit';
import { ModelRig, ROTOR_NAMES } from '@/components/viewers/model/rig';
import { SKY, dur, ease, easeCss, hero, media, px } from '@/lib/motion';
import { UI } from '@/lib/strings';
import { rotorModelGlb, type RotorModelOptions } from './fixtures/rotor-model';

const DEG = Math.PI / 180;

async function loadFixture(options: RotorModelOptions = {}): Promise<GLTF> {
  const bytes = await rotorModelGlb(options);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new GLTFLoader().parseAsync(buffer, '');
}

/** The world direction a node's local +y (a rotor plate's face) points to. */
function faceOf(node: { getWorldQuaternion: (q: Quaternion) => Quaternion; updateWorldMatrix: (p: boolean, c: boolean) => void }): Vector3 {
  node.updateWorldMatrix(true, false);
  return new Vector3(0, 1, 0).applyQuaternion(node.getWorldQuaternion(new Quaternion()));
}

function materialsOf(rig: ModelRig): Material[] {
  const found: Material[] = [];
  rig.root.traverse((object) => {
    const mesh = object as Mesh;
    if (mesh.isMesh && !(object.parent as Mesh | null)?.isMesh) found.push(...(Array.isArray(mesh.material) ? mesh.material : [mesh.material]));
  });
  return found;
}

describe('lib/motion.ts: the model groups hold the sheets numbers', () => {
  it('has sheet 6.3 for every model viewer', () => {
    expect(media.model).toMatchObject({
      loadMargin: 200,
      maxLive: 2,
      autoTurn: 6,
      damping: 0.08,
      pitchMin: -10,
      pitchMax: 60,
      zoomMin: 0.6,
      zoomMax: 2,
    });
    expect(media.model.reset).toEqual({ duration: 0.6, ease: ease.move });
    expect(media.model.viewFade).toEqual({ duration: dur.short, ease: ease.fade });
    expect(media.model.explode).toEqual({ max: 0.6, keyStep: 0.1, keyDuration: 0.16, keyEase: ease.settle });
    expect(media.model.hintFade).toEqual({ duration: 0.15, ease: ease.fade });
  });

  it('has sheet 4.5 for the hero model, with the lens fade and the load after the page is interactive', () => {
    expect(hero.model).toMatchObject({ returnWait: 1.5, returnDuration: 1.2, returnEase: ease.move, viewFade: 0.2, phoneTurn: 6 });
    expect(hero.model.lensFade).toEqual({ duration: dur.quick, ease: ease.fade });
    expect(hero.model.posterOut).toEqual({ duration: dur.quick, ease: ease.fade });
    expect(hero.model.afterInteractive).toEqual({ idleTimeout: SKY.liveLoad.idleTimeout, noIdleDelay: SKY.liveLoad.noIdleDelay });
    expect(hero.rotor.modelMax).toBe(90);
  });
});

describe('orbit.ts: limits and speeds (sheet 6.3)', () => {
  it('keeps pitch between 10 degrees below the horizon and 60 above', () => {
    expect(POLAR_MIN / DEG).toBeCloseTo(30, 10);
    expect(POLAR_MAX / DEG).toBeCloseTo(100, 10);
    // The three-quarter view sits inside them.
    expect(HOME_PHI).toBeGreaterThan(POLAR_MIN);
    expect(HOME_PHI).toBeLessThan(POLAR_MAX);
  });

  it('turns 6 degrees a second, in the viewers and in the hero after a tap', () => {
    expect(AUTO_TURN).toBeCloseTo(6 * DEG, 12);
    expect(HERO_TURN).toBeCloseTo(6 * DEG, 12);
    // One turn a minute.
    expect((2 * Math.PI) / AUTO_TURN).toBeCloseTo(60, 9);
  });

  it('keeps the zoom between 0.6 and 2 times the fitted distance', () => {
    expect(clampZoom(0.1)).toBe(0.6);
    expect(clampZoom(5)).toBe(2);
    expect(clampZoom(1.3)).toBe(1.3);
    expect(clampZoom(Number.NaN)).toBe(1);
  });

  it('fits the model to the view, and to a wider poster contained in a narrower stage', () => {
    const square = fitDistance(35, 1);
    expect(fitDistance(35, 1.6)).toBeCloseTo(square, 12);
    expect(fitDistance(35, 0.5)).toBeGreaterThan(square);
    // No poster, or a poster no wider than the canvas: the plain fit.
    expect(posterFitDistance(35, 1.6)).toBeCloseTo(fitDistance(35, 1.6), 12);
    expect(posterFitDistance(35, 1.6, 4 / 3)).toBeCloseTo(fitDistance(35, 4 / 3), 12);
    // The hero's 600 by 560 stage and the admin's 4:3 poster: the poster fills 0.80 of the height.
    const stage = 600 / 560;
    expect(posterFitDistance(35, stage, 4 / 3)).toBeCloseTo(fitDistance(35, 4 / 3) * (4 / 3 / stage), 12);
  });
});

describe('orbit.ts: the hero (sheets 4.1, 4.3, 4.5)', () => {
  it('tilts the rotors 0 to 90 degrees with the hero scroll, linear and clamped', () => {
    expect(rotorTilt(0)).toBe(0);
    expect(rotorTilt(0.25) / DEG).toBeCloseTo(22.5, 10);
    expect(rotorTilt(0.5) / DEG).toBeCloseTo(45, 10);
    expect(rotorTilt(1) / DEG).toBeCloseTo(90, 10);
    expect(rotorTilt(1.4)).toBe(rotorTilt(1));
    expect(rotorTilt(-0.3)).toBe(0);
    expect(rotorTilt(Number.NaN)).toBe(0);
  });

  it('holds the rotors at hover without motion, and draws no frame for a scroll that leaves the tilt as it is', () => {
    expect(heroRotorTilt(0.4, true)).toBe(rotorTilt(0.4));
    // Reduced motion or the pause control: hover, whatever the scroll.
    for (const progress of [0, 0.4, 1, 3]) expect(heroRotorTilt(progress, false)).toBe(0);
    // Past the hero the tilt holds at cruise, so further scrolling asks for nothing.
    expect(heroRotorTilt(1.3, true)).toBe(heroRotorTilt(2, true));
    expect(heroRotorTilt(1.3, true) / DEG).toBeCloseTo(90, 10);
  });

  it('measures the hero scroll from the page at rest to the hero bottom at the nav', () => {
    expect(heroScrollProgress(0, 800)).toBe(0);
    expect(heroScrollProgress(400, 800)).toBe(0.5);
    expect(heroScrollProgress(1200, 800)).toBe(1);
    expect(heroScrollProgress(-20, 800)).toBe(0);
    expect(heroScrollProgress(100, 0)).toBe(0);
  });

  it('sizes the lens as the drawing does: 220 px across where the drawing is 515.6 px wide', () => {
    const drawingAt1440 = (hero.drawing.width * px.lens) / (2 * hero.lens.radius);
    expect(drawingAt1440).toBeCloseTo(515.625, 9);
    expect(2 * lensRadius(drawingAt1440)).toBeCloseTo(px.lens, 9);
    expect(lensRadius(300)).toBeCloseTo(64, 9);
    expect(lensRadius(-5)).toBe(0);
  });

  it('keeps the lens centre inside the inner frame', () => {
    const [w, h] = [600, 560];
    expect(clampLensCenter(300, 196, w, h)).toEqual({ x: 300, y: 196 });
    expect(clampLensCenter(-50, 900, w, h)).toEqual({ x: 40, y: 520 });
    expect(clampLensCenter(9999, -9, w, h)).toEqual({ x: 560, y: 40 });
    // It scales with the stage.
    expect(clampLensCenter(0, 0, 300, 280)).toEqual({ x: 20, y: 20 });
  });

  it('frames the lens square in CSS px and in clip space', () => {
    expect(lensSquare(50, 50, 25, 100, 100)).toEqual({ left: 25, top: 25, side: 50, clip: [-0.5, -0.5, 0.5, 0.5] });
    const square = lensSquare(30, 20, 10, 200, 100);
    expect(square?.clip.map((v) => Number(v.toFixed(6)))).toEqual([-0.8, 0.4, -0.6, 0.8]);
    expect(lensSquare(50, 50, 0, 100, 100)).toBeNull();
    expect(lensSquare(50, 50, 10, 0, 100)).toBeNull();
  });
});

describe('orbit.ts: the exploded view, the hint and the camera ease (sheet 6.3)', () => {
  it('steps the exploded view 0.1 a key, held between 0 and 1', () => {
    expect(stepExplode(0.3, 1)).toBe(0.4);
    expect(stepExplode(0.95, 1)).toBe(1);
    expect(stepExplode(0.05, -1)).toBe(0);
    expect(stepExplode(0.7, -1)).toBe(0.6);
  });

  it('moves the farthest part 0.6 of the model radius along its line, and the others in proportion', () => {
    // The farthest part itself (its line is 5 long).
    expect(explodeOffset([3, 4, 0], 5, 1).map((v) => Number(v.toFixed(9)))).toEqual([0.36, 0.48, 0]);
    const line: [number, number, number] = [0.1, -2, 7];
    expect(Math.hypot(...explodeOffset(line, Math.hypot(...line), 2))).toBeCloseTo(1.2, 12);
    // A part a quarter as far out moves a quarter as far, on its own line.
    expect(explodeOffset([1, 0, 0], 4, 1).map((v) => Number(v.toFixed(9)))).toEqual([0.15, 0, 0]);
    // A part at the centre, or a model whose parts all sit there, stays.
    expect(explodeOffset([0, 0, 0], 4, 1)).toEqual([0, 0, 0]);
    expect(explodeOffset([0, 0, 0], 0, 1)).toEqual([0, 0, 0]);
  });

  it('gives the hint its 150 ms fade', () => {
    expect(HINT_FADE_VARS).toEqual({ '--mv-hint-fade': '150ms', '--mv-hint-ease': easeCss.fade });
  });

  it('eases the camera the short way round, from where it is to the three-quarter view', () => {
    expect(shortestTurn(3, -3)).toBeCloseTo(2 * Math.PI - 6, 12);
    expect(shortestTurn(-3, 3)).toBeCloseTo(6 - 2 * Math.PI, 12);
    expect(shortestTurn(0, Math.PI)).toBeCloseTo(Math.PI, 12);
    const from: OrbitState = { theta: 3, phi: 1, radius: 4, target: [0, 1, 0] };
    const home: OrbitState = { theta: HOME_THETA, phi: HOME_PHI, radius: 3, target: [0, 0, 0] };
    expect(blendOrbit(from, home, 0)).toEqual(from);
    const end = blendOrbit(from, home, 1);
    expect(Math.abs(shortestTurn(end.theta, HOME_THETA))).toBeLessThan(1e-12);
    expect([end.phi, end.radius, ...end.target]).toEqual([HOME_PHI, 3, 0, 0, 0]);
    const middle = blendOrbit(from, home, 0.5);
    expect(middle.radius).toBe(3.5);
    expect(middle.target).toEqual([0, 0.5, 0]);
    expect(sameOrbit(end, home)).toBe(true);
    expect(sameOrbit(from, home)).toBe(false);
  });

  it('reads the sheet curves as functions', () => {
    const move = easing(ease.move);
    expect(move(0)).toBe(0);
    expect(move(1)).toBe(1);
    expect(move(0.5)).toBeCloseTo(0.5, 6);
    expect(move(0.25)).toBeLessThan(0.25);
    expect(easing(ease.move)).toBe(move);
  });
});

describe('IdleReturn: back to the view 1.5 s after the last input (sheet 4.5)', () => {
  /** A clock the test moves by hand. */
  function fakeTimers() {
    let now = 0;
    let next = 1;
    const queue = new Map<number, { at: number; run: () => void }>();
    const timers: Timers = {
      set: (run, ms) => {
        const id = next++;
        queue.set(id, { at: now + ms, run });
        return id;
      },
      clear: (handle) => void queue.delete(handle as number),
    };
    const advance = (ms: number) => {
      now += ms;
      for (const [id, entry] of [...queue]) {
        if (entry.at <= now) {
          queue.delete(id);
          entry.run();
        }
      }
    };
    return { timers, advance, pending: () => queue.size };
  }

  afterEach(() => vi.restoreAllMocks());

  it('goes back 1,500 ms after the last input ends', () => {
    const clock = fakeTimers();
    const fire = vi.fn();
    const idle = new IdleReturn(fire, undefined, clock.timers);
    idle.schedule(true);
    expect(idle.pending).toBe(true);
    clock.advance(1499);
    expect(fire).not.toHaveBeenCalled();
    clock.advance(1);
    expect(fire).toHaveBeenCalledTimes(1);
    expect(idle.pending).toBe(false);
  });

  it('waits again after every input, and not at all while one is under way', () => {
    const clock = fakeTimers();
    const fire = vi.fn();
    const idle = new IdleReturn(fire, undefined, clock.timers);
    idle.schedule(true);
    clock.advance(1000);
    idle.cancel(); // a drag starts
    clock.advance(5000);
    expect(fire).not.toHaveBeenCalled();
    idle.schedule(true); // and ends
    clock.advance(1000);
    idle.schedule(true); // a key
    clock.advance(1000);
    expect(fire).not.toHaveBeenCalled();
    clock.advance(500);
    expect(fire).toHaveBeenCalledTimes(1);
    expect(clock.pending()).toBe(0);
  });

  it('never goes back without motion: the model stays where it is left', () => {
    const clock = fakeTimers();
    const fire = vi.fn();
    const idle = new IdleReturn(fire, undefined, clock.timers);
    idle.schedule(false);
    clock.advance(10_000);
    expect(fire).not.toHaveBeenCalled();
    expect(idle.pending).toBe(false);
  });
});

describe('ModelRig on a GLB with RotorL and RotorR (tests/fixtures/rotor-model.ts)', () => {
  it('finds both rotors by name', async () => {
    const rig = new ModelRig((await loadFixture()).scene);
    expect(rig.rotors.map((rotor) => rotor.name)).toEqual([...ROTOR_NAMES]);
    rig.dispose();
  });

  it('turns each rotor about its own pivot, from up at hover to the front at cruise', async () => {
    const rig = new ModelRig((await loadFixture()).scene);
    const rest = rig.rotors.map((rotor) => ({ position: rotor.object.position.clone(), quaternion: rotor.object.quaternion.clone() }));
    for (const rotor of rig.rotors) expect(faceOf(rotor.object).y).toBeCloseTo(1, 9);

    rig.setRotorTilt(rotorTilt(1));
    rig.rotors.forEach((rotor, i) => {
      const face = faceOf(rotor.object);
      expect(face.z).toBeCloseTo(1, 9);
      expect(face.y).toBeCloseTo(0, 9);
      expect(rotor.object.position.equals(rest[i].position)).toBe(true);
    });

    rig.setRotorTilt(rotorTilt(0.5));
    for (const rotor of rig.rotors) {
      const face = faceOf(rotor.object);
      expect(face.y).toBeCloseTo(Math.SQRT1_2, 9);
      expect(face.z).toBeCloseTo(Math.SQRT1_2, 9);
    }

    rig.setRotorTilt(0);
    rig.rotors.forEach((rotor, i) => expect(rotor.object.quaternion.angleTo(rest[i].quaternion)).toBeCloseTo(0, 9));
    rig.dispose();
  });

  it('tilts a rotor under a turned mount toward the model front too', async () => {
    const rig = new ModelRig((await loadFixture({ rotatedMount: true })).scene);
    const left = rig.rotors.find((rotor) => rotor.name === 'RotorL');
    expect(left).toBeDefined();
    rig.setRotorTilt(rotorTilt(1));
    const face = faceOf(left!.object);
    expect(face.z).toBeCloseTo(1, 9);
    expect(face.x).toBeCloseTo(0, 9);
    rig.dispose();
  });

  it('leaves a model without rotors as it is', async () => {
    const gltf = await loadFixture();
    gltf.scene.traverse((object) => {
      if ((ROTOR_NAMES as readonly string[]).includes(object.userData.name as string)) object.userData.name = 'Arm';
    });
    const rig = new ModelRig(gltf.scene);
    expect(rig.rotors).toEqual([]);
    // Nothing moved: no frame and no new shadow.
    expect(rig.setRotorTilt(rotorTilt(1))).toBe(false);
    rig.dispose();
  });

  it('says when a rotor moved, so the engine draws a frame and the shadow again only then', async () => {
    const rig = new ModelRig((await loadFixture()).scene);
    expect(rig.rotorAngle).toBe(0);
    expect(rig.setRotorTilt(rotorTilt(0.5))).toBe(true);
    expect(rig.rotorAngle / DEG).toBeCloseTo(45, 10);
    expect(rig.setRotorTilt(rotorTilt(0.5))).toBe(false);
    expect(rig.setRotorTilt(heroRotorTilt(0.5, false))).toBe(true);
    expect(rig.rotorAngle).toBe(0);
    rig.dispose();
  });

  it('explodes each part along its own line, the farthest by 0.6 of the model radius', async () => {
    const rig = new ModelRig((await loadFixture()).scene);
    const radius = rig.restBox.getSize(new Vector3()).length() / 2;
    const center = rig.restBox.getCenter(new Vector3());
    expect(rig.parts.map((part) => part.name)).toEqual(['Body', 'Crossbar', 'Tail', 'RotorL', 'RotorR']);
    const lines = rig.parts.map((part) => part.box.getCenter(new Vector3()).sub(center));
    const farthest = Math.max(...lines.map((line) => line.length()));
    const before = rig.parts.map((part) => part.object.getWorldPosition(new Vector3()));
    rig.setExplode(1);
    const travel = rig.parts.map((part, i) => {
      const moved = part.object.getWorldPosition(new Vector3()).sub(before[i]);
      expect(moved.length()).toBeCloseTo((media.model.explode.max * radius * lines[i].length()) / farthest, 9);
      if (lines[i].length() > 1e-6) expect(moved.clone().normalize().dot(lines[i].clone().normalize())).toBeCloseTo(1, 9);
      return moved.length();
    });
    expect(Math.max(...travel)).toBeCloseTo(media.model.explode.max * radius, 9);
    rig.setExplode(0);
    rig.parts.forEach((part, i) => expect(part.object.getWorldPosition(new Vector3()).distanceTo(before[i])).toBeCloseTo(0, 9));
    // The framing box grows with the explode.
    expect(rig.currentBox(1).getSize(new Vector3()).length()).toBeGreaterThan(rig.currentBox(0, new Box3()).getSize(new Vector3()).length());
    rig.dispose();
  });

  it('fills the Blueprint solid with the night in a viewer, and with depth only in the hero', async () => {
    const gltf = await loadFixture();
    for (const [fill, colorWrite] of [
      ['night', true],
      ['depth', false],
    ] as const) {
      const rig = new ModelRig(gltf.scene, { fill });
      rig.setView('blueprint');
      const fills = materialsOf(rig).filter((material): material is MeshBasicMaterial => material instanceof MeshBasicMaterial);
      expect(fills.length).toBeGreaterThan(0);
      for (const material of fills) expect(material.colorWrite).toBe(colorWrite);
      // The edges and the silhouette draw after the solids, so the fill's depth is there to hide
      // what is behind it even when the fill writes no color (the hero showed a solid silhouette).
      let lines = 0;
      rig.root.traverse((object) => {
        const parent = object.parent as Mesh | null;
        if (!parent?.isMesh) return;
        lines += 1;
        expect(object.renderOrder).toBeGreaterThan(parent.renderOrder);
      });
      expect(lines).toBeGreaterThan(0);
      rig.dispose();
    }
  });

  it('draws one frame in the Thermal view and comes back to the view it shows', async () => {
    const rig = new ModelRig((await loadFixture()).scene);
    rig.setView('realistic');
    const shown = materialsOf(rig);
    let during: Material[] = [];
    rig.withView('thermal', () => {
      during = materialsOf(rig);
    });
    expect(during.length).toBe(shown.length);
    expect(during.every((material) => material instanceof ShaderMaterial)).toBe(true);
    expect(rig.currentView).toBe('realistic');
    const after = materialsOf(rig);
    expect(after.length).toBe(shown.length);
    expect(after.every((material, i) => material === shown[i])).toBe(true);
    rig.dispose();
  });
});

describe('ContactShadow: drawn again only when the model changes (contactShadow.ts)', () => {
  /** A renderer that records what it is asked to draw, and where. */
  function recordingRenderer(scene: Scene, shadow: ContactShadow) {
    const draws: { what: 'depth' | 'blur'; into: unknown; hidden: boolean; override: Material | null }[] = [];
    let target: unknown = 'screen';
    const gl = {
      getRenderTarget: () => target,
      setRenderTarget: (next: unknown) => {
        target = next;
      },
      render: (object: Object3D) => {
        draws.push({ what: object === scene ? 'depth' : 'blur', into: target, hidden: !shadow.root.visible, override: scene.overrideMaterial });
      },
    };
    return { gl: gl as unknown as WebGLRenderer, draws, target: () => target };
  }

  it('draws on the first frame, then only after the model changed, never for an orbit', () => {
    const shadow = new ContactShadow();
    const scene = new Scene();
    scene.add(shadow.root);
    const { gl, draws } = recordingRenderer(scene, shadow);
    expect(shadow.needsUpdate).toBe(true);
    shadow.update(gl, scene);
    // The model's depth from the floor, then two blurs (drei's blur and its finer `smooth` pass),
    // each a horizontal and a vertical pass.
    expect(draws.map((draw) => draw.what)).toEqual(['depth', 'blur', 'blur', 'blur', 'blur']);
    expect(shadow.needsUpdate).toBe(false);

    draws.length = 0;
    shadow.update(gl, scene); // an orbit frame, the model unchanged
    expect(draws).toEqual([]);

    shadow.markDirty(); // the exploded view or a rotor moved
    shadow.update(gl, scene);
    expect(draws.filter((draw) => draw.what === 'depth')).toHaveLength(1);

    draws.length = 0;
    shadow.setFloor(shadow.root.position.y); // the same floor
    shadow.update(gl, scene);
    expect(draws).toEqual([]);
    shadow.setFloor(-0.7); // a new floor
    expect(shadow.root.position.y).toBe(-0.7);
    shadow.update(gl, scene);
    expect(draws.filter((draw) => draw.what === 'depth')).toHaveLength(1);
    shadow.dispose();
  });

  it('casts with the depth material, out of sight of itself, and leaves the renderer and the scene as it found them', () => {
    const shadow = new ContactShadow();
    const scene = new Scene();
    scene.add(shadow.root);
    const { gl, draws, target } = recordingRenderer(scene, shadow);
    shadow.update(gl, scene);
    const [depth] = draws;
    expect(depth.override).toBeInstanceOf(MeshDepthMaterial);
    expect(depth.hidden).toBe(true);
    expect(depth.into).not.toBe('screen');
    expect(target()).toBe('screen');
    expect(scene.overrideMaterial).toBeNull();
    expect(shadow.root.visible).toBe(true);
    // The look the viewer has had since Phase 4.
    expect(SHADOW).toMatchObject({ size: 4, far: 1.6, blur: 2.4, opacity: 0.5, resolution: 512 });
    shadow.dispose();
  });
});

describe('the hero model on the server (components/home/hero/HeroModel.tsx)', () => {
  it('resolves a model file, and nothing for an empty or non-model setting, so the hero falls back', () => {
    expect(heroModelMedia(undefined)).toBeNull();
    expect(heroModelMedia({ kind: 'model', src: '', alt: '' })).toBeNull();
    expect(heroModelMedia({ kind: 'image', src: '/media/site/img-7414.webp', alt: '' })).toBeNull();
    const media = heroModelMedia({ kind: 'model', src: '/media/raven/raven.glb', alt: 'Raven, the owner model' });
    expect(media).toMatchObject({ kind: 'model', alt: 'Raven, the owner model', file: { src: '/media/raven/raven.glb', ext: 'glb' } });
  });

  it('hands a model file to the lazily loaded viewer, as the resolved media and the caption only', () => {
    const model = { kind: 'model' as const, src: '/media/raven/raven.glb', alt: 'Raven, the owner model' };
    const element = HeroModel({ model, fallback: 'drawing' });
    expect(isValidElement(element)).toBe(true);
    if (!isValidElement(element)) return;
    // The model gets the hero's art slot here; the drawing (the fallback) brings its own.
    const slot = element as ReactElement<{ className: string; children: ReactElement }>;
    expect(slot.type).toBe('div');
    expect(slot.props.className).toBe('hm-hero__art');
    const viewer = slot.props.children;
    expect(isValidElement(viewer)).toBe(true);
    expect(viewer.type).toBe(HeroModelLazy);
    expect(viewer.props).toEqual({ media: heroModelMedia(model), caption: UI.heroCaption });
  });
});
