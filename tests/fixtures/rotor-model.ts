/**
 * A test model for the model viewers (ARCHITECTURE.md 6: "the scroll-tied rotor tilt when the
 * model has nodes named RotorL and RotorR"; motion sheets 4.3 and 6.3): plain boxes in five named
 * parts, two of them nodes named RotorL and RotorR at the ends of a crossbar, each holding a flat
 * plate whose face points up (+y), as a rotor's disc does at hover. Test geometry only, never site
 * content: tests/model-viewer.test.ts reads it, and the browser check serves a copy of it.
 *
 * glTF's frame: +y up, the front toward +z, +x to the model's left; RotorL sits at +x.
 *
 * Run it to write the GLB file (Node strips the types):
 *   node tests/fixtures/rotor-model.ts <out.glb> [--rotated-mount]
 */
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { Document, NodeIO, type Material, type Mesh } from '@gltf-transform/core';

/** The six faces of a box: the axis each faces along, and its sign. */
const FACES: [number, 1 | -1][] = [
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [2, 1],
  [2, -1],
];

/** A box `size` wide, high and deep, centred on its node's origin, with a normal per face. */
function box(doc: Document, name: string, size: [number, number, number], material: Material): Mesh {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (const [axis, sign] of FACES) {
    const u = (axis + 1) % 3;
    const v = (axis + 2) % 3;
    const base = positions.length / 3;
    for (const [a, b] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      const p = [0, 0, 0];
      p[axis] = (sign * size[axis]) / 2;
      p[u] = (a * size[u]) / 2;
      p[v] = (b * size[v]) / 2;
      positions.push(...p);
      const n = [0, 0, 0];
      n[axis] = sign;
      normals.push(...n);
    }
    // Counter-clockwise seen from outside.
    if (sign > 0) indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    else indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  const buffer = doc.getRoot().listBuffers()[0];
  const primitive = doc
    .createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(positions)).setBuffer(buffer))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(normals)).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array(indices)).setBuffer(buffer))
    .setMaterial(material);
  return doc.createMesh(name).addPrimitive(primitive);
}

export interface RotorModelOptions {
  /**
   * Put RotorL under a mount node turned a quarter turn about y, so its parent's frame is not the
   * model's: its tilt must still take its plate's face toward the front.
   */
  rotatedMount?: boolean;
}

/** The test model as a glTF-Transform document. */
export function rotorModelDocument(options: RotorModelOptions = {}): Document {
  const doc = new Document();
  doc.createBuffer();
  const body = doc.createMaterial('Body').setBaseColorFactor([0.62, 0.65, 0.7, 1]).setMetallicFactor(0.3).setRoughnessFactor(0.5);
  const dark = doc.createMaterial('Dark').setBaseColorFactor([0.1, 0.11, 0.13, 1]).setMetallicFactor(0.1).setRoughnessFactor(0.6);

  const plate = box(doc, 'Plate', [0.7, 0.02, 0.7], dark);
  const rotor = (name: 'RotorL' | 'RotorR') =>
    doc.createNode(name).addChild(doc.createNode(`${name} plate`).setMesh(plate).setTranslation([0, 0.02, 0]));

  const root = doc
    .createNode('Test assembly')
    .addChild(doc.createNode('Body').setMesh(box(doc, 'Body', [0.3, 0.3, 2], body)))
    .addChild(doc.createNode('Crossbar').setMesh(box(doc, 'Crossbar', [2.6, 0.06, 0.4], body)).setTranslation([0, 0.1, 0.2]))
    .addChild(doc.createNode('Tail').setMesh(box(doc, 'Tail', [0.8, 0.05, 0.3], body)).setTranslation([0, 0.2, -1]));

  const left = rotor('RotorL');
  if (options.rotatedMount) {
    // A quarter turn about y: the mount's x axis points along the model's -z.
    const s = Math.SQRT1_2;
    root.addChild(doc.createNode('Mount').setTranslation([1.3, 0.25, 0.2]).setRotation([0, s, 0, s]).addChild(left));
  } else {
    root.addChild(left.setTranslation([1.3, 0.25, 0.2]));
  }
  root.addChild(rotor('RotorR').setTranslation([-1.3, 0.25, 0.2]));

  doc.createScene('Test').addChild(root);
  return doc;
}

/** The test model as GLB bytes. */
export async function rotorModelGlb(options: RotorModelOptions = {}): Promise<Uint8Array> {
  return new NodeIO().writeBinary(rotorModelDocument(options));
}

// Run as a script: write the GLB where asked.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = process.argv[2];
  if (!out) throw new Error('Usage: node tests/fixtures/rotor-model.ts <out.glb> [--rotated-mount]');
  writeFileSync(out, await rotorModelGlb({ rotatedMount: process.argv.includes('--rotated-mount') }));
}
