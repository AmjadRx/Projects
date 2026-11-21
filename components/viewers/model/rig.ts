/**
 * One loaded model, prepared for the viewer: a private copy of the scene, centered and scaled to
 * fit a sphere of radius 1, with its parts, its three views, the exploded view, highlighting, and
 * the wing rotors of a model that names them. Plain three.js, no React. The parsed file stays
 * untouched in the loader's cache, so another viewer of the same file, or this one after a resume,
 * starts clean.
 */
import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  EdgesGeometry,
  Group,
  InstancedMesh,
  LineDashedMaterial,
  LineSegments,
  Matrix3,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  SRGBColorSpace,
  Vector3,
  type Material,
  type Object3D,
  type ShaderMaterial,
  type Vector2,
} from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import type { ModelView } from '../types';
import { createHullMaterial, createThermalMaterial, createThermalShared, setThermalStops, type ThermalShared } from './materials';
import { explodeOffset } from './orbit';
import type { ModelPalette, Rgb } from './palette';

/**
 * The nodes the hero tilts with scroll (ARCHITECTURE.md 6, motion sheet 4.3), by the exact names
 * the file gives them: the left and right wing rotors.
 */
export const ROTOR_NAMES = ['RotorL', 'RotorR'] as const;
export type RotorName = (typeof ROTOR_NAMES)[number];

/**
 * The axis the rotors tilt about: the model's spanwise axis, x. glTF models face +z with +y up, so
 * a positive turn about x takes a rotor's thrust from up (hover) toward the front (cruise).
 */
const ROTOR_AXIS = new Vector3(1, 0, 0);

/**
 * Blueprint lines draw after every solid (three.js draws the lower render order first), so the
 * fill's depth is always there to hide what lies behind it, also when the fill writes no color.
 */
const LINES_AFTER_SOLIDS = 1;

/** Edges between faces that meet at more than this angle (degrees) are drawn in Blueprint. */
const EDGE_ANGLE = 30;
/** Blueprint edge and silhouette widths, in CSS pixels. */
const EDGE_WIDTH = 1.25;
/** How strongly the highlighted part glows in the Realistic view. */
const HIGHLIGHT_GLOW = 0.55;
/** How much of the line color tints the highlighted part's fill in the Blueprint view. */
const HIGHLIGHT_TINT = 0.24;

export interface RigPart {
  id: string;
  name: string;
  object: Object3D;
  /** Position at rest, in the parent's space. */
  rest: Vector3;
  /** Offset at full explode, in the parent's space. */
  localOffset: Vector3;
  /** Offset at full explode, in world space. */
  worldOffset: Vector3;
  /** Bounds at rest, in world space. */
  box: Box3;
}

/** A wing rotor the hero tilts: turned about its own pivot (its origin) by setRotorTilt. */
export interface RigRotor {
  name: RotorName;
  object: Object3D;
  /** Its orientation at rest, in the parent's space. */
  rest: Quaternion;
  /** The model's spanwise axis, in the parent's space. */
  axis: Vector3;
}

/**
 * How the Blueprint view fills the solid so hidden edges stay hidden: with the night (a viewer,
 * over its night well) or with nothing but depth (the hero, so the sky shows through the drawing).
 */
export type BlueprintFill = 'night' | 'depth';

export interface RigOptions {
  fill?: BlueprintFill;
}

interface EmissiveMaterial extends Material {
  emissive: Color;
  emissiveIntensity: number;
}

interface MeshEntry {
  mesh: Mesh;
  part: RigPart | null;
  /** The model's own materials (private copies). */
  realistic: Material | Material[];
  twoSided: boolean;
  emissive: { material: EmissiveMaterial; color: Color; intensity: number }[];
  fill?: MeshBasicMaterial;
  edges?: LineSegments2;
  hull?: Mesh;
}

const edgeCache = new WeakMap<BufferGeometry, Float32Array>();

function edgePositions(geometry: BufferGeometry): Float32Array {
  let positions = edgeCache.get(geometry);
  if (!positions) {
    const edges = new EdgesGeometry(geometry, EDGE_ANGLE);
    positions = new Float32Array(edges.getAttribute('position').array);
    edges.dispose();
    edgeCache.set(geometry, positions);
  }
  return positions;
}

/** The twelve edges of a box, as line-segment pairs. */
function boxEdges(box: Box3, target: Float32Array): void {
  const { min, max } = box;
  const corners = [0, 1, 2, 3, 4, 5, 6, 7].map(
    (k) => [k & 1 ? max.x : min.x, k & 2 ? max.y : min.y, k & 4 ? max.z : min.z] as const,
  );
  const pairs = [
    [0, 1], [2, 3], [4, 5], [6, 7],
    [0, 2], [1, 3], [4, 6], [5, 7],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  pairs.forEach(([a, b], i) => {
    target.set(corners[a], i * 6);
    target.set(corners[b], i * 6 + 3);
  });
}

function isEmissive(material: Material): material is EmissiveMaterial {
  const candidate = material as Partial<EmissiveMaterial>;
  return candidate.emissive instanceof Color && typeof candidate.emissiveIntensity === 'number';
}

function asList(material: Material | Material[]): Material[] {
  return Array.isArray(material) ? material : [material];
}

function srgb(color: Color, rgb: Rgb): Color {
  return color.setRGB(rgb[0], rgb[1], rgb[2], SRGBColorSpace);
}

/** The name the file gives a node, as written (the loader keeps it in userData.name). */
function authoredName(object: Object3D): string {
  const name = (object.userData as { name?: unknown }).name;
  return typeof name === 'string' ? name.trim() : '';
}

function isDrawable(object: Object3D): boolean {
  return (object as Mesh).isMesh === true;
}

export class ModelRig {
  /** Add this to the scene. */
  readonly root = new Group();
  readonly parts: RigPart[] = [];
  /** RotorL and RotorR, those the model names (ROTOR_NAMES order). */
  readonly rotors: RigRotor[] = [];
  /** Model bounds at rest, after centering and scaling. */
  readonly restBox = new Box3();

  /** Centers and scales the model; the envelope lives beside it, in world space. */
  private readonly frame = new Group();
  private readonly entries: MeshEntry[] = [];
  private readonly staticBox = new Box3();
  private readonly fill: BlueprintFill;
  private view: ModelView = 'realistic';
  private highlight: string | null = null;
  private explode = 0;
  private tilt = 0;
  private envelopeWanted = false;
  private blueprintReady = false;
  private readonly lineMaterial = new LineMaterial({ linewidth: EDGE_WIDTH, worldUnits: false, toneMapped: false });
  private readonly hullMaterial = createHullMaterial();
  private readonly thermalShared: ThermalShared = createThermalShared();
  /** One thermal material per part: they differ in the exploded-view shift and the dimming. */
  private readonly thermal = new Map<RigPart | null, ShaderMaterial>();
  private readonly lineColor = new Color(1, 1, 1);
  private readonly panelColor = new Color(0, 0, 0);
  private readonly tintColor = new Color(0, 0, 0);
  private readonly lineGeometries: LineSegmentsGeometry[] = [];
  /** The bounding box, dashed, that the Blueprint callouts point to. */
  private readonly envelope: LineSegments<BufferGeometry, LineDashedMaterial>;

  constructor(source: Object3D, options: RigOptions = {}) {
    this.fill = options.fill ?? 'night';
    const model = source.clone(true);
    model.traverse((object) => {
      if (!isDrawable(object)) return;
      const mesh = object as Mesh;
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map((m) => m.clone()) : mesh.material.clone();
    });
    this.frame.add(model);
    this.root.add(this.frame);

    // Center the model on the origin and scale it to a sphere of radius 1.
    model.updateMatrixWorld(true);
    const bounds = new Box3().setFromObject(model);
    if (bounds.isEmpty()) bounds.set(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));
    const center = bounds.getCenter(new Vector3());
    const radius = Math.max(bounds.getSize(new Vector3()).length() / 2, 1e-6);
    this.frame.scale.setScalar(1 / radius);
    this.frame.position.copy(center).multiplyScalar(-1 / radius);
    this.root.updateMatrixWorld(true);
    this.restBox.setFromObject(model);
    const modelCenter = this.restBox.getCenter(new Vector3());
    // The model's radius after scaling: 1 by construction, measured so the exploded view does not
    // depend on that.
    const modelRadius = Math.max(this.restBox.getSize(new Vector3()).length() / 2, 1e-6);

    // Parts: the named children of the model root, below any single wrapper nodes.
    let partRoot: Object3D = model;
    while (
      partRoot.children.length === 1 &&
      !isDrawable(partRoot) &&
      !isDrawable(partRoot.children[0]) &&
      partRoot.children[0].children.length > 0
    ) {
      partRoot = partRoot.children[0];
    }
    const toLocal = new Matrix3();
    const inverse = new Matrix4();
    // Each named part, its bounds, and its line from the model's centre; the longest line sets
    // how far every part moves at full explode.
    const named = partRoot.children.flatMap((child) => {
      const name = authoredName(child);
      if (!name) return [];
      const box = new Box3().setFromObject(child);
      const toPart = box.isEmpty() ? new Vector3() : box.getCenter(new Vector3()).sub(modelCenter);
      return [{ child, name, box, toPart }];
    });
    const farthest = Math.max(0, ...named.map(({ toPart }) => toPart.length()));
    named.forEach(({ child, name, box, toPart }) => {
      const worldOffset = new Vector3(...explodeOffset([toPart.x, toPart.y, toPart.z], farthest, modelRadius));
      inverse.copy(child.parent?.matrixWorld ?? new Matrix4()).invert();
      const localOffset = worldOffset.clone().applyMatrix3(toLocal.setFromMatrix4(inverse));
      this.parts.push({
        id: `part-${this.parts.length}`,
        name,
        object: child,
        rest: child.position.clone(),
        localOffset,
        worldOffset,
        box,
      });
    });

    // Meshes, each with its part (if any) and its own materials.
    model.traverse((object) => {
      if (!isDrawable(object)) return;
      const mesh = object as Mesh;
      let part: RigPart | null = null;
      for (let node: Object3D | null = mesh; node && !part; node = node.parent) {
        part = this.parts.find((p) => p.object === node) ?? null;
      }
      const materials = asList(mesh.material);
      this.entries.push({
        mesh,
        part,
        realistic: mesh.material,
        twoSided: materials.some((m) => m.side === DoubleSide),
        emissive: materials.filter(isEmissive).map((material) => ({
          material,
          color: material.emissive.clone(),
          intensity: material.emissiveIntensity,
        })),
      });
      if (!part) this.staticBox.union(new Box3().setFromObject(mesh));
    });

    // The wing rotors, by name. Each turns about its own origin; the spanwise axis is written in
    // its parent's space, so a rotor under a rotated parent still tilts toward the model's front.
    for (const name of ROTOR_NAMES) {
      let found: Object3D | null = null;
      model.traverse((object) => {
        if (!found && authoredName(object) === name) found = object;
      });
      const object = found as Object3D | null;
      if (!object) continue;
      const parentRotation = new Quaternion();
      object.parent?.getWorldQuaternion(parentRotation);
      this.rotors.push({
        name,
        object,
        rest: object.quaternion.clone(),
        axis: ROTOR_AXIS.clone().applyQuaternion(parentRotation.invert()).normalize(),
      });
    }

    const envelopeGeometry = new BufferGeometry();
    envelopeGeometry.setAttribute('position', new BufferAttribute(new Float32Array(72), 3));
    this.envelope = new LineSegments(
      envelopeGeometry,
      new LineDashedMaterial({ dashSize: 0.045, gapSize: 0.035, transparent: true, opacity: 0.5, toneMapped: false }),
    );
    this.envelope.raycast = () => undefined;
    this.envelope.visible = false;
    this.root.add(this.envelope);
    this.updateEnvelope();
  }

  setPalette(palette: ModelPalette): void {
    srgb(this.lineColor, palette.line);
    srgb(this.panelColor, palette.panel);
    this.tintColor.copy(this.panelColor).lerp(this.lineColor, HIGHLIGHT_TINT);
    this.lineMaterial.color.copy(this.lineColor);
    this.envelope.material.color.copy(this.lineColor);
    (this.hullMaterial.uniforms.uColor.value as Vector3).set(...palette.line);
    setThermalStops(this.thermalShared, palette.ramp);
    this.applyHighlight();
  }

  setView(view: ModelView): void {
    this.view = view;
    this.applyView(view);
  }

  /** The view shown now. */
  get currentView(): ModelView {
    return this.view;
  }

  /**
   * Draws one frame of another view: `draw` runs with that view's materials on the model, and the
   * shown view comes back after it. The hero's lens draws the Thermal view this way, inside the
   * Realistic one (lensPass.ts).
   */
  withView(view: ModelView, draw: () => void): void {
    if (view === this.view) {
      draw();
      return;
    }
    this.applyView(view);
    try {
      draw();
    } finally {
      this.applyView(this.view);
    }
  }

  /**
   * Sheet 4.3: turns RotorL and RotorR about their pivots, by this many radians from their pose
   * at rest (0 is hover, a quarter turn is cruise). A model without them is left as it is. Returns
   * true when a rotor moved, so the engine draws a frame and the contact shadow again only then.
   */
  setRotorTilt(angle: number): boolean {
    if (angle === this.tilt) return false;
    this.tilt = angle;
    for (const rotor of this.rotors) {
      rotor.object.quaternion.setFromAxisAngle(rotor.axis, angle).multiply(rotor.rest);
    }
    return this.rotors.length > 0;
  }

  /** The tilt the rotors show now, in radians (0 is hover). */
  get rotorAngle(): number {
    return this.tilt;
  }

  /** Shows the dashed bounding box in the Blueprint view (when there are callouts to point at it). */
  setEnvelope(wanted: boolean): void {
    this.envelopeWanted = wanted;
    this.envelope.visible = this.view === 'blueprint' && wanted;
  }

  setHighlight(partId: string | null): void {
    this.highlight = partId;
    this.applyHighlight();
  }

  /**
   * Sheet 6.3: 0 is assembled; 1 has moved each part out along the line from the model's centre to
   * its own, the farthest part by 0.6 of the model's radius and the others in proportion
   * (orbit.ts explodeOffset).
   */
  setExplode(amount: number): void {
    this.explode = Math.min(1, Math.max(0, amount));
    for (const part of this.parts) {
      part.object.position.copy(part.rest).addScaledVector(part.localOffset, this.explode);
    }
    for (const [part, material] of this.thermal) this.applyShift(part, material);
    this.updateEnvelope();
    this.root.updateMatrixWorld(true);
  }

  /** The bounds of the model at this exploded-view amount (now, by default), in world space. */
  currentBox(amount = this.explode, target = new Box3()): Box3 {
    target.copy(this.staticBox);
    const moved = new Box3();
    const shift = new Vector3();
    for (const part of this.parts) {
      if (part.box.isEmpty()) continue;
      moved.copy(part.box).translate(shift.copy(part.worldOffset).multiplyScalar(amount));
      target.union(moved);
    }
    if (target.isEmpty()) target.copy(this.restBox);
    return target;
  }

  /** The silhouette width is set in screen pixels, so the shader needs the canvas size. */
  setResolution(width: number, height: number): void {
    (this.hullMaterial.uniforms.uResolution.value as Vector2).set(Math.max(1, width), Math.max(1, height));
  }

  dispose(): void {
    for (const entry of this.entries) {
      entry.mesh.material = entry.realistic;
      entry.fill?.dispose();
      for (const material of asList(entry.realistic)) material.dispose();
    }
    for (const geometry of this.lineGeometries) geometry.dispose();
    for (const material of this.thermal.values()) material.dispose();
    this.lineMaterial.dispose();
    this.hullMaterial.dispose();
    this.envelope.geometry.dispose();
    this.envelope.material.dispose();
  }

  private updateEnvelope(): void {
    const position = this.envelope.geometry.getAttribute('position') as BufferAttribute;
    boxEdges(this.currentBox(), position.array as Float32Array);
    position.needsUpdate = true;
    this.envelope.geometry.computeBoundingSphere();
    this.envelope.computeLineDistances();
  }

  /** Puts a view's materials and helpers on the model, without changing the view it shows. */
  private applyView(view: ModelView): void {
    if (view === 'blueprint') this.ensureBlueprint();
    for (const entry of this.entries) {
      if (view === 'realistic') entry.mesh.material = entry.realistic;
      else if (view === 'blueprint') entry.mesh.material = entry.fill ?? entry.realistic;
      else entry.mesh.material = this.thermalFor(entry.part);
      if (entry.edges) entry.edges.visible = view === 'blueprint';
      if (entry.hull) entry.hull.visible = view === 'blueprint';
    }
    this.envelope.visible = view === 'blueprint' && this.envelopeWanted;
  }

  private thermalFor(part: RigPart | null): ShaderMaterial {
    let material = this.thermal.get(part);
    if (!material) {
      material = createThermalMaterial(this.thermalShared);
      this.applyShift(part, material);
      material.uniforms.uDim.value = this.dimFor(part);
      this.thermal.set(part, material);
    }
    return material;
  }

  private applyShift(part: RigPart | null, material: ShaderMaterial): void {
    const shift = material.uniforms.uShift.value as Vector3;
    if (part) shift.copy(part.worldOffset).multiplyScalar(this.explode);
    else shift.set(0, 0, 0);
  }

  private dimFor(part: RigPart | null): number {
    return this.highlight !== null && part?.id !== this.highlight ? 1 : 0;
  }

  /** Builds the Blueprint helpers the first time that view is shown. */
  private ensureBlueprint(): void {
    if (this.blueprintReady) return;
    this.blueprintReady = true;
    for (const entry of this.entries) {
      const { mesh } = entry;
      // Two-sided, so the fill hides what is behind it whatever the triangle winding. In the hero
      // it writes depth only: hidden edges stay hidden and the sky shows through the solid.
      entry.fill = new MeshBasicMaterial({
        color: this.panelColor,
        colorWrite: this.fill === 'night',
        toneMapped: false,
        side: DoubleSide,
        // Pushed back a little, so edges drawn on the surface win the depth test.
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      });
      const instanced = (mesh as InstancedMesh).isInstancedMesh === true;
      const skinned = (mesh as Mesh & { isSkinnedMesh?: boolean }).isSkinnedMesh === true;
      if (skinned || !mesh.geometry.getAttribute('position')) continue;

      if (!instanced) {
        const positions = edgePositions(mesh.geometry);
        if (positions.length > 0) {
          const geometry = new LineSegmentsGeometry().setPositions(positions);
          this.lineGeometries.push(geometry);
          const edges = new LineSegments2(geometry, this.lineMaterial);
          edges.raycast = () => undefined;
          edges.renderOrder = LINES_AFTER_SOLIDS;
          edges.visible = false;
          mesh.add(edges);
          entry.edges = edges;
        }
      }

      // A silhouette needs normals and a closed surface; open, two-sided parts keep their edges only.
      if (!entry.twoSided && mesh.geometry.getAttribute('normal')) {
        let hull: Mesh;
        if (instanced) {
          const source = mesh as InstancedMesh;
          const copy = new InstancedMesh(mesh.geometry, this.hullMaterial, source.count);
          copy.instanceMatrix = source.instanceMatrix;
          hull = copy;
        } else {
          hull = new Mesh(mesh.geometry, this.hullMaterial);
        }
        hull.raycast = () => undefined;
        hull.renderOrder = LINES_AFTER_SOLIDS;
        hull.visible = false;
        mesh.add(hull);
        entry.hull = hull;
      }
    }
    this.applyHighlight();
  }

  private applyHighlight(): void {
    const target = this.highlight;
    for (const entry of this.entries) {
      const on = target !== null && entry.part?.id === target;
      for (const slot of entry.emissive) {
        if (on) {
          slot.material.emissive.copy(this.lineColor);
          slot.material.emissiveIntensity = HIGHLIGHT_GLOW;
        } else {
          slot.material.emissive.copy(slot.color);
          slot.material.emissiveIntensity = slot.intensity;
        }
      }
      entry.fill?.color.copy(on ? this.tintColor : this.panelColor);
    }
    for (const [part, material] of this.thermal) material.uniforms.uDim.value = this.dimFor(part);
  }
}
