/**
 * STEP files (ARCHITECTURE.md 13A; docs/V3_PLAN.md D-81, R-11, Q-22). occt-import-js, the
 * WebAssembly build of the Open CASCADE kernel (LGPL-2.1 with its exception), reads the file in
 * one dedicated worker, public/admin-workers/occt-worker.js. Its bindings build functions from
 * strings, so that worker file alone is served with a policy that allows it, and every page stays
 * strict. The worker gets at most 50 MB and 120 seconds; past either, the owner is asked for a
 * GLB or STL export instead. The meshes it returns (names, colors, positions, normals, indices)
 * become a three.js scene that the model module converts like any other model.
 */
import type { Group, Mesh, Object3D } from 'three';
import { CONVERT_MESSAGES as M } from './messages';
import { PrepareError } from './types';
import { abortError, STEP_MAX_BYTES, STEP_TIMEOUT_MS, throwIfAborted, type PrepareContext } from './util';

/** The worker's address; it loads /vendor/occt/occt-import-js.js and .wasm (scripts/copy-vendor.mjs). */
export const STEP_WORKER_URL = '/admin-workers/occt-worker.js';

/** Triangulation settings: meters (glTF's unit), and the kernel's default fineness. */
export const STEP_PARAMS = {
  linearUnit: 'meter',
  linearDeflectionType: 'bounding_box_ratio',
  linearDeflection: 0.001,
  angularDeflection: 0.5,
} as const;

export type Rgb = [number, number, number];

export interface StepMesh {
  name: string;
  color: Rgb | null;
  positions: Float32Array;
  normals: Float32Array | null;
  indices: Uint32Array;
  /** The B-rep faces as triangle ranges (inclusive), each with its own color or null. */
  faces: { first: number; last: number; color: Rgb | null }[];
}

export interface StepNode {
  name: string;
  meshes: number[];
  children: StepNode[];
}

export interface StepResult {
  root: StepNode;
  meshes: StepMesh[];
}

/** What the worker answers. */
type WorkerReply = { ok: true; root: StepNode; meshes: StepMesh[] } | { ok: false; code: 'blocked' | 'unreadable' | 'complex'; message?: string };

/** The part of a Worker this module uses, so tests can drive it with a stand-in. */
export interface WorkerLike {
  postMessage(message: unknown, transfer: Transferable[]): void;
  terminate(): void;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent | Event) => void) | null;
}

/** Refuses a STEP file over the 50 MB cap before anything is read. */
export function checkStepSize(file: { name: string; size: number }): void {
  if (file.size > STEP_MAX_BYTES) throw new PrepareError('step-too-large', file.name, M.stepTooLarge);
}

/**
 * Sends the bytes to a new worker and waits for its meshes. The worker is always terminated at
 * the end: on an answer, on an error, after `timeoutMs`, or when the signal aborts.
 */
export function runStepWorker(
  bytes: ArrayBuffer,
  options: { name: string; createWorker: () => WorkerLike; timeoutMs?: number; signal?: AbortSignal },
): Promise<StepResult> {
  const { name, createWorker, signal } = options;
  const timeoutMs = options.timeoutMs ?? STEP_TIMEOUT_MS;
  return new Promise<StepResult>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError(signal));
      return;
    }
    let worker: WorkerLike;
    try {
      worker = createWorker();
    } catch {
      reject(new PrepareError('step-blocked', name, M.stepBlocked));
      return;
    }
    let settled = false;
    const finish = (outcome: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
      outcome();
    };
    const onAbort = () => finish(() => reject(abortError(signal)));
    const timer = setTimeout(() => finish(() => reject(new PrepareError('step-timeout', name, M.stepTimeout))), timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    worker.onmessage = (event: MessageEvent) => {
      const reply = event.data as WorkerReply;
      if (reply && reply.ok) {
        finish(() => resolve({ root: reply.root, meshes: reply.meshes }));
      } else if (reply && reply.code === 'blocked') {
        finish(() => reject(new PrepareError('step-blocked', name, M.stepBlocked)));
      } else if (reply && reply.code === 'complex') {
        finish(() => reject(new PrepareError('step-too-complex', name, M.stepTimeout)));
      } else {
        finish(() => reject(new PrepareError('step-unreadable', name, M.stepUnreadable)));
      }
    };
    worker.onerror = () => finish(() => reject(new PrepareError('step-blocked', name, M.stepBlocked)));
    worker.postMessage({ bytes, params: STEP_PARAMS }, [bytes]);
  });
}

/** Counts the meshes and triangles of a result. */
export function stepTriangles(result: StepResult): number {
  return result.meshes.reduce((sum, mesh) => sum + Math.floor(mesh.indices.length / 3), 0);
}

type Three = typeof import('three');

/**
 * A neutral light gray for parts the file gives no color. The kernel reports colors in linear RGB
 * (Open CASCADE's Quantity_Color), which is also three.js's working space, so they are used as
 * they are; this gray is that space's value of sRGB 0.72, 0.74, 0.77.
 */
const DEFAULT_COLOR: Rgb = [0.477, 0.507, 0.554];

function sameColor(a: Rgb | null, b: Rgb | null): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(a[0] - b[0]) < 1e-4 && Math.abs(a[1] - b[1]) < 1e-4 && Math.abs(a[2] - b[2]) < 1e-4;
}

function buildMesh(THREE: Three, source: StepMesh, materials: Map<string, InstanceType<Three['MeshStandardMaterial']>>): Mesh {
  const material = (rgb: Rgb) => {
    const key = rgb.map((value) => value.toFixed(4)).join(',');
    let found = materials.get(key);
    if (!found) {
      found = new THREE.MeshStandardMaterial({ metalness: 0.1, roughness: 0.55 });
      found.color.setRGB(rgb[0], rgb[1], rgb[2]);
      materials.set(key, found);
    }
    return found;
  };
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(source.positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(source.indices, 1));
  if (source.normals && source.normals.length === source.positions.length) {
    geometry.setAttribute('normal', new THREE.BufferAttribute(source.normals, 3));
  } else {
    geometry.computeVertexNormals();
  }
  const base = source.color ?? DEFAULT_COLOR;
  const faces = source.faces.filter((face) => face.last >= face.first);
  const triangles = Math.floor(source.indices.length / 3);
  // Groups must cover every triangle, or the uncovered ones would not be drawn.
  const contiguous =
    faces.length > 0 &&
    faces[0].first === 0 &&
    faces[faces.length - 1].last + 1 === triangles &&
    faces.every((face, i) => i === 0 || face.first === faces[i - 1].last + 1);
  const colored = contiguous && faces.some((face) => face.color !== null && !sameColor(face.color, base));
  let mesh: Mesh;
  if (!colored) {
    mesh = new THREE.Mesh(geometry, material(base));
  } else {
    // One group per run of faces with the same color; GLTFExporter writes one primitive per group.
    const list: InstanceType<Three['MeshStandardMaterial']>[] = [];
    let start = 0;
    let current: Rgb | null = null;
    let end = 0;
    const flush = () => {
      if (end <= start) return;
      const chosen = material(current ?? base);
      let index = list.indexOf(chosen);
      if (index < 0) index = list.push(chosen) - 1;
      geometry.addGroup(start * 3, (end - start) * 3, index);
    };
    for (const face of faces) {
      const color = face.color ?? base;
      if (face.first !== end || current === null || !sameColor(color, current)) {
        flush();
        start = face.first;
        current = color;
      }
      end = face.last + 1;
    }
    flush();
    mesh = new THREE.Mesh(geometry, list);
  }
  mesh.name = source.name;
  return mesh;
}

/** The three.js scene of a STEP result: one group per assembly node, named as the file names them. */
export function buildStepScene(THREE: Three, result: StepResult): Group {
  const materials = new Map<string, InstanceType<Three['MeshStandardMaterial']>>();
  const build = (node: StepNode, depth: number): Group => {
    const group = new THREE.Group();
    group.name = node.name;
    for (const index of node.meshes) {
      const source = result.meshes[index];
      if (source && source.indices.length >= 3) group.add(buildMesh(THREE, source, materials));
    }
    if (depth < 64) for (const child of node.children) group.add(build(child, depth + 1));
    return group;
  };
  return build(result.root, 0);
}

/** Reads a STEP file in its worker and returns its scene. */
export async function readStep(file: File, THREE: Three, context: PrepareContext): Promise<Object3D> {
  checkStepSize(file);
  const bytes = await file.arrayBuffer();
  throwIfAborted(context.signal);
  context.progress('decode', 0);
  const result = await runStepWorker(bytes, {
    name: file.name,
    createWorker: () => new Worker(STEP_WORKER_URL) as unknown as WorkerLike,
    timeoutMs: STEP_TIMEOUT_MS,
    signal: context.signal,
  });
  context.progress('decode', 1);
  return buildStepScene(THREE, result);
}
