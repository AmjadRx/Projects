/**
 * The model conversion (lib/admin/convert/model.ts) run for real under Node: three.js's loaders,
 * GLTFExporter, glTF-Transform, and meshoptimizer, with only a FileReader stand-in (GLTFExporter
 * reads its output through one). The poster needs WebGL and is left out here, as in any browser
 * without it; /dev-convert covers it in a real browser.
 *
 * Regressions of the Phase 6 review: node names on a shared mesh (CONVERT-1), every name in the
 * stored GLB reaching the content check (CONVERT-4), binary PLY (CONVERT-5), and the size cap on
 * models read on the page (CONVERT-8).
 */
import { Document, WebIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer/decoder';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_CHECK_ITEMS } from '@/lib/admin/contract';
import { detect, isBinaryPly, sniff } from '@/lib/admin/convert/detect';
import { CONVERT_MESSAGES as M } from '@/lib/admin/convert/messages';
import { checkModelSize, glbNamesOf, prepareModel } from '@/lib/admin/convert/model';
import { PrepareError } from '@/lib/admin/convert/types';
import { createContext, MODEL_MAX_BYTES } from '@/lib/admin/convert/util';
import { checkBodies, checkItemsFor } from '@/components/admin/media/logic';

/** GLTFExporter writes a GLB through FileReader, which Node does not have. */
class FileReaderStandIn {
  result: ArrayBuffer | string | null = null;
  onload: (() => void) | null = null;
  onloadend: (() => void) | null = null;
  readAsArrayBuffer(blob: Blob) {
    void blob.arrayBuffer().then((buffer) => {
      this.result = buffer;
      this.onload?.();
      this.onloadend?.();
    });
  }
}

const globals = globalThis as unknown as { FileReader?: unknown };
const originalFileReader = globals.FileReader;
beforeAll(() => {
  globals.FileReader = FileReaderStandIn;
});
afterAll(() => {
  globals.FileReader = originalFileReader;
});

/** A triangle at x = dx, as a POSITION accessor. */
function triangle(doc: Document, dx: number) {
  return doc
    .createAccessor()
    .setType('VEC3')
    .setArray(new Float32Array([dx, 0, 0, dx + 1, 0, 0, dx, 1, 0]))
    .setBuffer(doc.getRoot().listBuffers()[0] ?? doc.createBuffer());
}

async function glb(doc: Document): Promise<Uint8Array> {
  return new WebIO().writeBinary(doc);
}

/** The stored GLB, read back with every extension the converter writes. */
async function readStored(bytes: Uint8Array): Promise<Document> {
  await MeshoptDecoder.ready;
  const io = new WebIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  return io.readBinary(bytes);
}

async function prepared(bytes: Uint8Array, name: string, format: 'glb' | 'ply') {
  const file = new File([bytes as Uint8Array<ArrayBuffer>], name);
  const upload = await prepareModel({ main: file, companions: [] }, { format, ext: format }, createContext(name));
  const stored = await readStored(new Uint8Array(await upload.parts[0].blob.arrayBuffer()));
  return { upload, stored };
}

// ---------------------------------------------------------------------------------------------

describe('node names on a shared mesh (CONVERT-1)', () => {
  it('keeps RotorL and RotorR when both nodes show the mesh "Rotor"', async () => {
    const doc = new Document();
    doc.createBuffer();
    const rotor = doc.createMesh('Rotor').addPrimitive(doc.createPrimitive().setAttribute('POSITION', triangle(doc, 0)));
    const frame = doc.createMesh('FrameMesh').addPrimitive(doc.createPrimitive().setAttribute('POSITION', triangle(doc, 5)));
    doc
      .createScene('Scene')
      .addChild(doc.createNode('RotorL').setMesh(rotor).setTranslation([-2, 0, 0]))
      .addChild(doc.createNode('RotorR').setMesh(rotor).setTranslation([2, 0, 0]))
      .addChild(doc.createNode('Frame').setMesh(frame));

    const { upload, stored } = await prepared(await glb(doc), 'drone.glb', 'glb');
    const nodes = stored.getRoot().listNodes();
    expect(nodes.map((node) => node.getName()).sort()).toEqual(['Frame', 'RotorL', 'RotorR']);
    // Each name stays on its own node: RotorR sits 4 units right of RotorL (quantization shifts
    // both translations by the same offset, so only the difference is compared).
    const byName = new Map(nodes.map((node) => [node.getName(), node]));
    const x = (name: string) => byName.get(name)?.getTranslation()[0] ?? Number.NaN;
    expect(x('RotorR') - x('RotorL')).toBeCloseTo(4);
    // Both nodes still show the one mesh, which keeps its own name.
    expect(byName.get('RotorL')?.getMesh()?.getName()).toBe('Rotor');
    expect(byName.get('RotorR')?.getMesh()?.getName()).toBe('Rotor');
    expect(upload.meta.partNames).toEqual(expect.arrayContaining(['RotorL', 'RotorR', 'Rotor', 'Frame', 'FrameMesh']));
  }, 60_000);

  it("keeps a node's own name when its extras hold a \"name\" too (three copies extras over it)", async () => {
    const doc = new Document();
    doc.createBuffer();
    const rotor = doc.createMesh('Rotor').addPrimitive(doc.createPrimitive().setAttribute('POSITION', triangle(doc, 0)));
    doc
      .createScene('Scene')
      .addChild(doc.createNode('RotorL').setMesh(rotor).setExtras({ name: 'Name in extras' }))
      .addChild(doc.createNode('RotorR').setMesh(rotor).setTranslation([4, 0, 0]));

    const { upload, stored } = await prepared(await glb(doc), 'extras.glb', 'glb');
    expect(stored.getRoot().listNodes().map((node) => node.getName()).sort()).toEqual(['RotorL', 'RotorR']);
    // Extras never reach the stored file.
    expect(upload.meta.partNames).not.toContain('Name in extras');
  }, 60_000);

  it('never gives an unnamed node the name of another node that shares its mesh', async () => {
    const doc = new Document();
    doc.createBuffer();
    const rotor = doc.createMesh('Rotor').addPrimitive(doc.createPrimitive().setAttribute('POSITION', triangle(doc, 0)));
    doc
      .createScene('Scene')
      .addChild(doc.createNode().setMesh(rotor).setTranslation([-2, 0, 0]))
      .addChild(doc.createNode('RotorR').setMesh(rotor).setTranslation([2, 0, 0]));

    const { stored } = await prepared(await glb(doc), 'pair.glb', 'glb');
    const nodes = stored.getRoot().listNodes();
    expect(nodes.filter((node) => node.getName() === 'RotorR')).toHaveLength(1);
    // The name is on the right-hand node (quantization shifts both by the same offset).
    const named = nodes.find((node) => node.getName() === 'RotorR');
    const other = nodes.find((node) => node !== named && node.getMesh());
    expect((named?.getTranslation()[0] ?? Number.NaN) - (other?.getTranslation()[0] ?? Number.NaN)).toBeCloseTo(4);
  }, 60_000);
});

// ---------------------------------------------------------------------------------------------

describe('every name in the stored GLB reaches the content check (CONVERT-4)', () => {
  it('lists all 600 parts, past the 500th, and the material, with no cap', async () => {
    const doc = new Document();
    doc.createBuffer();
    const scene = doc.createScene('Scene');
    const material = doc.createMaterial('Finish chosen by Ulysses Brightwater');
    for (let i = 0; i < 600; i += 1) {
      const mesh = doc.createMesh(`Mesh ${i}`).addPrimitive(doc.createPrimitive().setAttribute('POSITION', triangle(doc, i)).setMaterial(material));
      scene.addChild(doc.createNode(i === 550 ? 'Bracket by Zelda Quartermain' : `Part ${i}`).setMesh(mesh));
    }

    const { upload, stored } = await prepared(await glb(doc), 'assembly.glb', 'glb');
    const names = upload.meta.partNames ?? [];
    const storedNames = [
      ...stored.getRoot().listNodes().map((node) => node.getName()),
      ...stored.getRoot().listMeshes().map((mesh) => mesh.getName()),
      ...stored.getRoot().listMaterials().map((each) => each.getName()),
    ].filter((name) => name !== '');
    expect(storedNames).toContain('Bracket by Zelda Quartermain');
    expect(storedNames).toContain('Finish chosen by Ulysses Brightwater');
    // Every name the stored file holds is listed, each once.
    for (const name of storedNames) expect(names).toContain(name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.length).toBeGreaterThan(1200);

    // And every one of them goes out in a check request, split under the route's item limit.
    const bodies = checkBodies('assembly.glb', checkItemsFor('assembly.glb', upload));
    expect(bodies.every((body) => body.items.length <= MAX_CHECK_ITEMS)).toBe(true);
    const sent = new Set(bodies.flatMap((body) => body.items.map((item) => item.text)));
    for (const name of names) expect(sent.has(name)).toBe(true);
  }, 120_000);

  it('lists animation, scene, and material names, and drops other extras as before', async () => {
    const doc = new Document();
    const buffer = doc.createBuffer();
    const material = doc.createMaterial('Anodized by Zelda Quartermain');
    const mesh = doc.createMesh('Hub').addPrimitive(doc.createPrimitive().setAttribute('POSITION', triangle(doc, 0)).setMaterial(material));
    const node = doc.createNode('Rotor hub').setMesh(mesh).setExtras({ note: 'private note' });
    doc.createScene('Assembly by Ulysses Brightwater').addChild(node);
    const times = doc.createAccessor().setType('SCALAR').setArray(new Float32Array([0, 1])).setBuffer(buffer);
    const positions = doc.createAccessor().setType('VEC3').setArray(new Float32Array([0, 0, 0, 0, 1, 0])).setBuffer(buffer);
    const sampler = doc.createAnimationSampler().setInput(times).setOutput(positions).setInterpolation('LINEAR');
    doc
      .createAnimation('Spin test by Zelda Quartermain')
      .addSampler(sampler)
      .addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath('translation').setSampler(sampler));

    const { upload, stored } = await prepared(await glb(doc), 'hub.glb', 'glb');
    const names = upload.meta.partNames ?? [];
    expect(stored.getRoot().listAnimations().map((animation) => animation.getName())).toEqual(['Spin test by Zelda Quartermain']);
    expect(names).toEqual(
      expect.arrayContaining(['Rotor hub', 'Hub', 'Anodized by Zelda Quartermain', 'Spin test by Zelda Quartermain']),
    );
    // glTF's own keywords are not words of the owner's.
    for (const keyword of ['VEC3', 'SCALAR', 'LINEAR', 'translation', '2.0', 'EXT_meshopt_compression']) {
      expect(names).not.toContain(keyword);
    }
    // Extras other than the names never reach the stored file.
    expect(names).not.toContain('private note');
  }, 60_000);

  it('reads every string of a GLB, extras included, but not URIs, media types, or keywords', () => {
    const json = JSON.stringify({
      asset: { version: '2.0', generator: 'A tool', copyright: 'Zelda Quartermain' },
      extensionsUsed: ['KHR_lights_punctual'],
      scenes: [{ name: 'Main', nodes: [0] }],
      nodes: [{ name: 'Arm', extras: { type: 'Kept: inside extras', label: 'Label' } }],
      images: [{ name: 'Logo', uri: 'textures/logo.png', mimeType: 'image/png' }],
      accessors: [{ type: 'VEC3' }],
      extensions: { KHR_lights_punctual: { lights: [{ name: 'Key light', type: 'point' }] } },
    });
    const padded = json + ' '.repeat((4 - (json.length % 4)) % 4);
    const bytes = new Uint8Array(20 + padded.length);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, 0x46546c67, true);
    view.setUint32(4, 2, true);
    view.setUint32(8, bytes.length, true);
    view.setUint32(12, padded.length, true);
    view.setUint32(16, 0x4e4f534a, true);
    bytes.set(new TextEncoder().encode(padded), 20);
    expect(glbNamesOf(bytes)).toEqual(['A tool', 'Zelda Quartermain', 'Main', 'Arm', 'Kept: inside extras', 'Label', 'Logo', 'Key light']);
    expect(glbNamesOf(new Uint8Array(8))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------

/** A PLY with one triangle, in the binary form scanners and MeshLab write. */
function binaryPly(endian: 'little' | 'big', newline = '\n'): Uint8Array {
  const header = [
    'ply',
    `format binary_${endian}_endian 1.0`,
    'comment made by a scanner',
    'element vertex 3',
    'property float x',
    'property float y',
    'property float z',
    'element face 1',
    'property list uchar int vertex_indices',
    'end_header',
    '',
  ].join(newline);
  const head = new TextEncoder().encode(header);
  const body = new DataView(new ArrayBuffer(3 * 12 + 1 + 3 * 4));
  const little = endian === 'little';
  [0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((value, i) => body.setFloat32(i * 4, value, little));
  body.setUint8(36, 3);
  [0, 1, 2].forEach((index, i) => body.setInt32(37 + i * 4, index, little));
  const out = new Uint8Array(head.length + body.byteLength);
  out.set(head, 0);
  out.set(new Uint8Array(body.buffer), head.length);
  return out;
}

describe('binary PLY (CONVERT-5)', () => {
  it('recognizes binary PLY, little and big endian, with either line ending', async () => {
    for (const bytes of [binaryPly('little'), binaryPly('big'), binaryPly('little', '\r\n')]) {
      expect(isBinaryPly(bytes)).toBe(true);
      const result = sniff(bytes, 'scan.ply', bytes.length);
      expect(result.kind === 'format' && result.detected.format).toBe('ply');
    }
    // The name plays no part: the bytes decide.
    expect(await detect(new File([binaryPly('little') as Uint8Array<ArrayBuffer>], 'scan.bin'))).toMatchObject({ format: 'ply', ext: 'ply' });
    // ASCII PLY is still found by the text sniff, and other binary data is not taken for PLY.
    expect(isBinaryPly(new TextEncoder().encode('ply\nformat ascii 1.0\nelement vertex 3\n'))).toBe(false);
    expect(isBinaryPly(new TextEncoder().encode('plywood\nformat binary_little_endian 1.0\n'))).toBe(false);
  });

  it('converts a binary PLY to a GLB with its triangle', async () => {
    const bytes = binaryPly('little');
    expect(await detect(new File([bytes as Uint8Array<ArrayBuffer>], 'scan.ply'))).toMatchObject({ format: 'ply' });
    const { upload, stored } = await prepared(bytes, 'scan.ply', 'ply');
    expect(upload.kind).toBe('model');
    expect(upload.parts[0]).toMatchObject({ role: 'main', name: 'scan.glb', contentType: 'model/gltf-binary' });
    expect(upload.meta.triangles).toBe(1);
    expect(stored.getRoot().listMeshes()).toHaveLength(1);
  }, 60_000);
});

// ---------------------------------------------------------------------------------------------

/** A file that fails the test if anything reads it. */
function unreadFile(name: string, size: number): File {
  const fail = () => {
    throw new Error(`${name} was read`);
  };
  return { name, size, type: '', arrayBuffer: fail, text: fail, slice: fail, stream: fail } as unknown as File;
}

describe('the size cap on models read on the page (CONVERT-8)', () => {
  it('refuses a model over 150 MB, its files counted, before reading it', async () => {
    expect(MODEL_MAX_BYTES).toBe(150_000_000);
    expect(M.modelTooLarge).toContain('150 MB');
    expect(() => checkModelSize({ main: { name: 'ok.obj', size: MODEL_MAX_BYTES }, companions: [] })).not.toThrow();
    for (const group of [
      { main: unreadFile('scan.obj', MODEL_MAX_BYTES + 1), companions: [] },
      { main: unreadFile('scene.gltf', 2_000), companions: [unreadFile('scene.bin', MODEL_MAX_BYTES), unreadFile('wood.png', 1_000)] },
    ]) {
      const format = group.main.name.endsWith('.obj') ? 'obj' : 'gltf';
      const error = await prepareModel(group, { format, ext: format }, createContext(group.main.name)).then(
        () => null,
        (reason: unknown) => reason,
      );
      expect(error).toBeInstanceOf(PrepareError);
      expect(error).toMatchObject({ code: 'model-too-large', file: group.main.name, message: M.modelTooLarge });
    }
  });
});
