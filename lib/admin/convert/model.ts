/**
 * 3D models (ARCHITECTURE.md 13A; docs/V3_PLAN.md D-24, D-81, Q-22). Every model becomes one
 * compressed GLB:
 *
 * 1. Read with three.js's loaders (GLB and glTF with the Draco and Meshopt decoders, STL, OBJ with
 *    its .mtl and textures, 3MF with its textures, PLY), or, for STEP, in the occt worker
 *    (./step.ts). Any model but STEP is read on the page itself, so one larger than 150 MB with its
 *    files is refused before it is read (ARCHITECTURE.md 11); STEP has its own cap.
 * 2. Written to GLB with GLTFExporter, after any material that is not PBR (the Phong materials of
 *    OBJ and 3MF) becomes a standard one. Node and mesh names travel through the exporter as marked
 *    extras, so the original names come back exactly (RotorL and RotorR stay, even when they show
 *    one shared mesh); every other extra is dropped, like the metadata of photos.
 * 3. Optimized with glTF-Transform: dedup, prune, weld, a simplify only above 1.5 million
 *    triangles (meshoptimizer's simplifier), textures resized to at most 2048 px and stored as
 *    WebP (EXT_texture_webp, never KTX2, D-81) by the canvas encoder in ./webp.ts, then reorder and
 *    Meshopt compression (EXT_meshopt_compression).
 * 4. Loaded back with a GLTFLoader set up as the site's viewer sets it up
 *    (components/viewers/model/loader.ts: Draco from /vendor/draco/ and three's Meshopt decoder),
 *    which proves the site can read it, and drawn once as a 1600 x 1200 WebP poster: a transparent
 *    background, the viewer's studio light, and the viewer's starting view.
 *
 * meta.triangles counts what is drawn after conversion; meta.partNames lists every name the stored
 * GLB holds (nodes, meshes, materials, animations, scenes, textures, and any other string of its
 * JSON but glTF's own keywords), each once and with no cap, for the content check (D-24).
 */
import type { AnimationClip, LoadingManager, Material, Mesh, Object3D, Texture } from 'three';
import type { GLTF, GLTFLoaderPlugin, GLTFParser } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Document as GltfDocument, Node as GltfNode, Primitive } from '@gltf-transform/core';
import type { Detected } from './detect';
import { CONVERT_MESSAGES as M, detailOf } from './messages';
import { PrepareError, type FileGroup, type PreparedPart, type PreparedUpload } from './types';
import {
  baseOf,
  extOf,
  fitWithin,
  isAbortError,
  lastSegment,
  matchKey,
  MODEL_MAX_BYTES,
  MODEL_POSTER_HEIGHT,
  MODEL_POSTER_WIDTH,
  MODEL_SIMPLIFY_ABOVE,
  originalOf,
  outputName,
  POSTER_QUALITY,
  posterName,
  TEXTURE_MAX_SIDE,
  TEXTURE_QUALITY,
  throwIfAborted,
  yieldToBrowser,
  type PrepareContext,
} from './util';
import { createRaster, drawScaled, encodeWebP, releaseRaster } from './webp';

type Three = typeof import('three');

/** Extras keys that carry the original names through GLTFExporter; removed after the export. */
const NODE_NAME = '__arNodeName';
const MESH_NAME = '__arMeshName';

/** The site's decoder files (scripts/copy-vendor.mjs), as components/viewers/model/loader.ts uses them. */
const DRACO_PATH = '/vendor/draco/';

/** The viewer's lens and starting view (components/viewers/model/ModelEngine.tsx). */
const POSTER_FOV = 35;
const HOME = [Math.sin(0.7) * Math.cos(0.38), Math.sin(0.38), Math.cos(0.7) * Math.cos(0.38)] as const;

/** How long the textures of an OBJ (named by its .mtl files) or a 3MF model get to load. */
const TEXTURE_LOAD_TIMEOUT_MS = 30_000;

interface Loaded {
  root: Object3D;
  animations: AnimationClip[];
  /** Set for glTF and GLB files: the loader's view of the original names. */
  gltf?: GLTF;
  /**
   * Set for glTF and GLB files: the node each loaded object was made from. The loader's own
   * associations cannot say it: every object that shows one shared mesh gets the same association
   * record, and that record's node is the last node read.
   */
  nodeOf?: ReadonlyMap<Object3D, number>;
}

// ---------------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------------

/** A loading manager that serves the dropped companion files and fetches nothing else. */
function companionManager(THREE: Three, companions: readonly File[], context: PrepareContext, missing: Set<string>): LoadingManager {
  const urls = new Map<string, string>();
  for (const file of companions) urls.set(matchKey(file.name), context.cleanup.url(file));
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => {
    if (/^(data|blob):/i.test(url)) return url;
    const found = urls.get(matchKey(url));
    if (found) return found;
    missing.add(lastSegment(matchKey(url)) || url);
    // An empty resource: the loader reports it as a failed part instead of fetching anything.
    return 'data:application/octet-stream;base64,';
  });
  return manager;
}

/**
 * Counts what a manager is loading, so a caller can wait until every item it started has ended
 * (loaded or failed). Textures named by an .mtl file, and those a 3MF holds, load on their own
 * after parsing returns. Install it before parsing, which starts those loads.
 */
function trackLoads(manager: LoadingManager): { settled: () => Promise<void> } {
  let pending = 0;
  let waiter: (() => void) | null = null;
  const start = manager.itemStart.bind(manager);
  const end = manager.itemEnd.bind(manager);
  manager.itemStart = (url: string) => {
    pending += 1;
    start(url);
  };
  manager.itemEnd = (url: string) => {
    end(url);
    pending = Math.max(0, pending - 1);
    if (pending === 0 && waiter) {
      const wake = waiter;
      waiter = null;
      wake();
    }
  };
  return {
    settled: () =>
      pending === 0
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, TEXTURE_LOAD_TIMEOUT_MS);
            waiter = () => {
              clearTimeout(timer);
              resolve();
            };
          }),
  };
}

/**
 * A GLTFLoader plugin that records the node each object comes from, as the loader builds it: the
 * loader asks its plugins for every node first, and this one hands the request back to the loader
 * and notes the object it returns.
 */
function nodeIndexPlugin(nodeOf: Map<Object3D, number>): (parser: GLTFParser) => GLTFLoaderPlugin {
  return (parser) => ({
    name: 'ar_node_index',
    loadNode: (nodeIndex: number) =>
      parser.loadNode(nodeIndex).then((object) => {
        if (!nodeOf.has(object)) nodeOf.set(object, nodeIndex);
        return object;
      }),
  });
}

/** A GLTFLoader set up as the site's viewer sets it up: Draco from /vendor/draco/, three's Meshopt decoder. */
async function createGltfLoader(manager?: LoadingManager) {
  const [{ GLTFLoader }, { DRACOLoader }, { MeshoptDecoder }] = await Promise.all([
    import('three/examples/jsm/loaders/GLTFLoader.js'),
    import('three/examples/jsm/loaders/DRACOLoader.js'),
    import('three/examples/jsm/libs/meshopt_decoder.module.js'),
  ]);
  // The Draco loader keeps the default manager, so the companion mapping never touches its decoder files.
  const draco = new DRACOLoader();
  draco.setDecoderPath(DRACO_PATH);
  draco.setDecoderConfig({ type: 'wasm' });
  draco.setWorkerLimit(2);
  const loader = new GLTFLoader(manager);
  loader.setDRACOLoader(draco);
  loader.setMeshoptDecoder(MeshoptDecoder);
  return { loader, dispose: () => draco.dispose() };
}

function standardMaterial(THREE: Three, vertexColors: boolean): Material {
  const material = new THREE.MeshStandardMaterial({ metalness: 0.1, roughness: 0.55, vertexColors });
  // A neutral light gray (sRGB), or white under vertex colors.
  if (vertexColors) material.color.setRGB(1, 1, 1);
  else material.color.setRGB(0.72, 0.74, 0.77, THREE.SRGBColorSpace);
  return material;
}

async function loadWithThree(
  THREE: Three,
  group: FileGroup,
  detected: Detected,
  context: PrepareContext,
  missing: Set<string>,
): Promise<Loaded> {
  const { main, companions } = group;
  const manager = companionManager(THREE, companions, context, missing);
  const name = baseOf(main.name);

  switch (detected.format) {
    case 'glb':
    case 'gltf': {
      const { loader, dispose } = await createGltfLoader(manager);
      const nodeOf = new Map<Object3D, number>();
      loader.register(nodeIndexPlugin(nodeOf));
      try {
        const data = detected.format === 'glb' ? await main.arrayBuffer() : await main.text();
        const gltf = await loader.parseAsync(data, '');
        return { root: gltf.scene, animations: gltf.animations ?? [], gltf, nodeOf };
      } finally {
        dispose();
      }
    }
    case 'stl': {
      const { STLLoader } = await import('three/examples/jsm/loaders/STLLoader.js');
      const geometry = new STLLoader().parse(await main.arrayBuffer());
      if (!geometry.hasAttribute('normal')) geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(geometry, standardMaterial(THREE, geometry.hasAttribute('color')));
      mesh.name = name;
      return { root: mesh, animations: [] };
    }
    case 'ply': {
      const { PLYLoader } = await import('three/examples/jsm/loaders/PLYLoader.js');
      const geometry = new PLYLoader().parse(await main.arrayBuffer());
      const colored = geometry.hasAttribute('color');
      let object: Object3D;
      if (geometry.index && geometry.index.count >= 3) {
        if (!geometry.hasAttribute('normal')) geometry.computeVertexNormals();
        object = new THREE.Mesh(geometry, standardMaterial(THREE, colored));
      } else {
        // A point cloud: no faces.
        object = new THREE.Points(geometry, new THREE.PointsMaterial({ size: 2, sizeAttenuation: false, vertexColors: colored }));
      }
      object.name = name;
      return { root: object, animations: [] };
    }
    case '3mf': {
      const { ThreeMFLoader } = await import('three/examples/jsm/loaders/3MFLoader.js');
      // Textures load from blob URLs after parse returns; the export needs their images.
      const loads = trackLoads(manager);
      const root = new ThreeMFLoader(manager).parse(await main.arrayBuffer());
      if (!root.name) root.name = name;
      await loads.settled();
      return { root, animations: [] };
    }
    case 'obj': {
      const [{ OBJLoader }, { MTLLoader }] = await Promise.all([
        import('three/examples/jsm/loaders/OBJLoader.js'),
        import('three/examples/jsm/loaders/MTLLoader.js'),
      ]);
      const loads = trackLoads(manager);
      const loader = new OBJLoader(manager);
      const libraries = companions.filter((file) => extOf(file.name) === 'mtl');
      if (libraries.length > 0) {
        const mtlLoader = new MTLLoader(manager);
        const creators = await Promise.all(libraries.map(async (file) => mtlLoader.parse(await file.text(), '')));
        const merged = creators[0];
        merged.setMaterials(Object.assign({}, ...creators.map((creator) => creator.materialsInfo)));
        merged.preload();
        loader.setMaterials(merged);
      }
      const root = loader.parse(await main.text());
      if (!root.name) root.name = name;
      await loads.settled();
      return { root, animations: [] };
    }
    default:
      throw new Error(`no reader for ${detected.format}`);
  }
}

// ---------------------------------------------------------------------------------------------
// Names and clean-up
// ---------------------------------------------------------------------------------------------

/** A material's properties, read by name (the loaders make several material classes). */
type MaterialFields = Material & Record<string, unknown>;

const textureOf = (value: unknown): Texture | null =>
  value && (value as { isTexture?: boolean }).isTexture ? (value as Texture) : null;

/**
 * The PBR material GLTFExporter writes well, made from any other. The OBJ and 3MF loaders make
 * Phong materials, which the exporter would write half metallic; they become standard materials
 * with no metal and a roughness from their shininess, keeping colors, textures, transparency, and
 * sides. Points and lines, which no light shades, get unlit materials.
 */
function standardMaterialFrom(THREE: Three, material: Material, unlit: boolean): Material {
  const source = material as MaterialFields;
  if (source.isMeshStandardMaterial === true || source.isMeshBasicMaterial === true) return material;
  const common = {
    name: material.name,
    transparent: material.transparent,
    opacity: material.opacity,
    alphaTest: material.alphaTest,
    side: material.side,
    vertexColors: material.vertexColors,
    map: textureOf(source.map),
    alphaMap: textureOf(source.alphaMap),
  };
  let result: InstanceType<Three['MeshStandardMaterial']> | InstanceType<Three['MeshBasicMaterial']>;
  if (unlit) {
    result = new THREE.MeshBasicMaterial(common);
  } else {
    const shininess = typeof source.shininess === 'number' && Number.isFinite(source.shininess) ? source.shininess : 30;
    const standard = new THREE.MeshStandardMaterial({
      ...common,
      metalness: 0,
      roughness: Math.min(1, Math.max(0.05, Math.sqrt(2 / (Math.max(0, shininess) + 2)))),
      normalMap: textureOf(source.normalMap),
      bumpMap: textureOf(source.bumpMap),
      aoMap: textureOf(source.aoMap),
      emissiveMap: textureOf(source.emissiveMap),
      flatShading: source.flatShading === true,
    });
    const emissive = source.emissive as InstanceType<Three['Color']> | undefined;
    if (emissive?.isColor) standard.emissive.copy(emissive);
    if (typeof source.bumpScale === 'number') standard.bumpScale = source.bumpScale;
    result = standard;
  }
  const color = source.color as InstanceType<Three['Color']> | undefined;
  if (color?.isColor) result.color.copy(color);
  // The textures now belong to the new material; only the old material itself is released.
  material.dispose();
  return result;
}

/** Gives every mesh, point cloud, and line a material GLTFExporter writes faithfully. */
function standardizeMaterials(THREE: Three, root: Object3D): void {
  const replaced = new Map<Material, Material>();
  root.traverse((object) => {
    const holder = object as Mesh;
    if (!holder.material) return;
    const flags = object as { isPoints?: boolean; isLine?: boolean };
    const unlit = flags.isPoints === true || flags.isLine === true;
    const convert = (material: Material): Material => {
      let result = replaced.get(material);
      if (!result) {
        result = standardMaterialFrom(THREE, material, unlit);
        replaced.set(material, result);
      }
      return result;
    };
    holder.material = Array.isArray(holder.material) ? holder.material.map(convert) : convert(holder.material);
  });
}

function hasGeometry(root: Object3D): boolean {
  let found = false;
  root.traverse((object) => {
    const mesh = object as Mesh;
    if ((mesh.isMesh || (object as { isPoints?: boolean }).isPoints) && (mesh.geometry?.getAttribute('position')?.count ?? 0) > 0) {
      found = true;
    }
  });
  return found;
}

/**
 * Marks every object with its original node name and, for meshes, its mesh name, and drops every
 * other extra (user data on objects, materials, and geometries), so only names survive the export.
 */
function markNames(loaded: Loaded): void {
  const json = loaded.gltf?.parser.json as { nodes?: { name?: unknown }[]; meshes?: { name?: unknown }[] } | undefined;
  const text = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined);
  loaded.root.traverse((object) => {
    let nodeName: string | undefined;
    let meshName: string | undefined;
    if (loaded.gltf) {
      // The file's own names, as written: three's loader keeps a cleaned copy on the object. The
      // node comes from what the loader built (nodeOf), never from the association's `nodes`,
      // which every copy of a shared mesh shares; the mesh index is the same for all of them. A
      // node the plugin did not see keeps the name the loader wrote on that very object.
      const reference = loaded.gltf.parser.associations.get(object);
      const nodeIndex = loaded.nodeOf?.get(object);
      if (nodeIndex !== undefined) nodeName = text(json?.nodes?.[nodeIndex]?.name);
      else if (reference?.nodes !== undefined) nodeName = text(object.userData?.name);
      if (reference?.meshes !== undefined) meshName = text(json?.meshes?.[reference.meshes]?.name);
    } else {
      nodeName = text(object.name);
      if ((object as Mesh).isMesh || (object as { isPoints?: boolean }).isPoints) meshName = text(object.name);
    }
    object.userData = {};
    if (nodeName) object.userData[NODE_NAME] = nodeName;
    if (meshName) object.userData[MESH_NAME] = meshName;
    const mesh = object as Mesh;
    if (mesh.geometry) mesh.geometry.userData = {};
    if (mesh.material) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) material.userData = {};
  });
}

const TEXTURE_SLOTS = [
  'map',
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'aoMap',
  'emissiveMap',
  'alphaMap',
  'bumpMap',
  'displacementMap',
  'lightMap',
  'specularMap',
  'clearcoatMap',
  'clearcoatNormalMap',
  'clearcoatRoughnessMap',
  'sheenColorMap',
  'sheenRoughnessMap',
  'transmissionMap',
  'thicknessMap',
  'iridescenceMap',
  'iridescenceThicknessMap',
  'anisotropyMap',
  'specularIntensityMap',
  'specularColorMap',
] as const;

/** Frees the GPU-side and decoded data of a scene: geometries, materials, textures, bitmaps. */
function disposeObject(root: Object3D): void {
  const textures = new Set<Texture>();
  root.traverse((object) => {
    const mesh = object as Mesh;
    mesh.geometry?.dispose();
    if (!mesh.material) return;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const slots = material as unknown as Record<string, Texture | null | undefined>;
      for (const slot of TEXTURE_SLOTS) {
        const texture = slots[slot];
        if (texture && (texture as { isTexture?: boolean }).isTexture) textures.add(texture);
      }
      material.dispose();
    }
  });
  for (const texture of textures) {
    const image = texture.image as { close?: () => void } | undefined;
    texture.dispose();
    if (image && typeof image.close === 'function') image.close();
  }
}

// ---------------------------------------------------------------------------------------------
// Export and optimization
// ---------------------------------------------------------------------------------------------

async function exportGlb(loaded: Loaded): Promise<ArrayBuffer> {
  const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
  const { root, animations } = loaded;
  root.updateMatrixWorld(true);
  // Animations are bound against the first exported object, so an animated model keeps its root.
  const identity = root.matrix.elements.every((value, i) => value === (i % 5 === 0 ? 1 : 0));
  const input = animations.length === 0 && identity && root.children.length > 0 && !root.userData[MESH_NAME] && !(root as Mesh).isMesh
    ? root.children
    : root;
  const result = await new GLTFExporter().parseAsync(input, {
    binary: true,
    onlyVisible: false,
    maxTextureSize: 4096,
    animations,
    includeCustomExtensions: false,
  });
  if (!(result instanceof ArrayBuffer)) throw new Error('the exporter did not write a GLB');
  return result;
}

/** Puts the marked names back on nodes and meshes and removes every extra and texture name. */
function restoreNames(doc: GltfDocument): void {
  const root = doc.getRoot();
  for (const node of root.listNodes()) {
    const extras = (node.getExtras() ?? {}) as Record<string, unknown>;
    const nodeName = extras[NODE_NAME];
    const meshName = extras[MESH_NAME];
    if (typeof nodeName === 'string') node.setName(nodeName);
    const mesh = node.getMesh();
    if (mesh && typeof meshName === 'string' && meshName) mesh.setName(meshName);
    node.setExtras({});
  }
  for (const mesh of root.listMeshes()) {
    mesh.setExtras({});
    for (const primitive of mesh.listPrimitives()) primitive.setExtras({});
  }
  for (const material of root.listMaterials()) material.setExtras({});
  // Texture and image names can hold a path on the author's computer.
  for (const texture of root.listTextures()) texture.setName('').setURI('').setExtras({});
  for (const scene of root.listScenes()) scene.setExtras({});
}

function primitiveTriangles(primitive: Primitive): number {
  const count = primitive.getIndices()?.getCount() ?? primitive.getAttribute('POSITION')?.getCount() ?? 0;
  switch (primitive.getMode()) {
    case 4: // TRIANGLES
      return Math.floor(count / 3);
    case 5: // TRIANGLE_STRIP
    case 6: // TRIANGLE_FAN
      return Math.max(0, count - 2);
    default:
      return 0;
  }
}

/** Triangles drawn by the scenes, counting a mesh once for every node that shows it. */
export function countTriangles(doc: GltfDocument): number {
  let total = 0;
  const visit = (node: GltfNode, depth: number) => {
    const mesh = node.getMesh();
    if (mesh) for (const primitive of mesh.listPrimitives()) total += primitiveTriangles(primitive);
    if (depth < 256) for (const child of node.listChildren()) visit(child, depth + 1);
  };
  for (const scene of doc.getRoot().listScenes()) for (const node of scene.listChildren()) visit(node, 0);
  return total;
}

/**
 * Keys whose values are glTF's own words (accessor types, interpolation, alpha modes, extension
 * names, the format version) or data (URIs and media types, as the server reads a GLB too).
 */
const GLTF_KEYWORD_KEYS = new Set([
  'type',
  'interpolation',
  'path',
  'alphaMode',
  'mode',
  'filter',
  'version',
  'minVersion',
  'extensionsUsed',
  'extensionsRequired',
  'uri',
  'mimeType',
]);

/** The JSON chunk of a GLB file, parsed, or null when there is none. */
function glbJsonOf(glb: Uint8Array): unknown {
  if (glb.byteLength < 20) return null;
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  const length = view.getUint32(12, true);
  if (view.getUint32(16, true) !== 0x4e4f534a || 20 + length > glb.byteLength) return null;
  try {
    return JSON.parse(new TextDecoder('utf-8').decode(glb.subarray(20, 20 + length)));
  } catch {
    return null;
  }
}

/**
 * Every name a GLB holds, each once, in the order of its JSON, for the content check (D-24): the
 * names of nodes, meshes, materials, animations, scenes, textures, images, skins, cameras, and
 * lights, the asset's generator and copyright, and any string kept in extras. Only glTF's own
 * keywords, URIs, and embedded data are left out. There is no cap: every name the stored file
 * holds is checked (the check requests are split by components/admin/media/logic.ts).
 */
export function glbNamesOf(glb: Uint8Array): string[] {
  const names = new Set<string>();
  const visit = (value: unknown, key: string, inExtras: boolean, depth: number) => {
    if (depth > 64) return;
    if (typeof value === 'string') {
      const clean = value.trim();
      if (clean && !/^data:/i.test(clean) && (inExtras || !GLTF_KEYWORD_KEYS.has(key))) names.add(clean);
    } else if (Array.isArray(value)) {
      for (const item of value) visit(item, key, inExtras, depth + 1);
    } else if (value && typeof value === 'object') {
      for (const [field, item] of Object.entries(value)) visit(item, field, inExtras || field === 'extras', depth + 1);
    }
  };
  visit(glbJsonOf(glb), '', false, 0);
  return [...names];
}

/** Every texture: at most 2048 px on the long side, WebP, through the canvas encoder. */
async function webpTextures(doc: GltfDocument, extension: Parameters<GltfDocument['createExtension']>[0], context: PrepareContext): Promise<void> {
  const textures = doc.getRoot().listTextures();
  let converted = 0;
  for (const [i, texture] of textures.entries()) {
    throwIfAborted(context.signal);
    const image = texture.getImage();
    if (!image) continue;
    const bitmap = await createImageBitmap(new Blob([image], { type: texture.getMimeType() || 'image/png' }), {
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'none',
    });
    try {
      const size = fitWithin(bitmap.width, bitmap.height, TEXTURE_MAX_SIDE);
      const raster = drawScaled(bitmap, size.width, size.height);
      try {
        const blob = await encodeWebP(raster, { quality: TEXTURE_QUALITY });
        texture.setImage(new Uint8Array(await blob.arrayBuffer())).setMimeType('image/webp');
        converted += 1;
      } finally {
        releaseRaster(raster);
      }
    } finally {
      bitmap.close();
    }
    context.progress('compress', 0.3 + (0.4 * (i + 1)) / textures.length);
    await yieldToBrowser();
  }
  if (converted > 0) doc.createExtension(extension).setRequired(true);
}

interface Optimized {
  bytes: Uint8Array;
  triangles: number;
  partNames: string[];
  simplifiedFrom: number | null;
}

async function optimize(glb: ArrayBuffer, context: PrepareContext): Promise<Optimized> {
  const [core, extensions, functions, { MeshoptEncoder }, { MeshoptSimplifier }] = await Promise.all([
    import('@gltf-transform/core'),
    import('@gltf-transform/extensions'),
    import('@gltf-transform/functions'),
    import('meshoptimizer/encoder'),
    import('meshoptimizer/simplifier'),
  ]);
  await Promise.all([MeshoptEncoder.ready, MeshoptSimplifier.ready]);
  const io = new core.WebIO()
    .registerExtensions(extensions.ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
  const doc = await io.readBinary(new Uint8Array(glb));
  restoreNames(doc);

  await doc.transform(
    functions.dequantize(),
    functions.dedup({ keepUniqueNames: true }),
    functions.prune({ keepLeaves: true }),
    functions.weld(),
  );
  context.progress('compress', 0.2);
  let triangles = countTriangles(doc);
  let simplifiedFrom: number | null = null;
  if (triangles > MODEL_SIMPLIFY_ABOVE) {
    simplifiedFrom = triangles;
    await doc.transform(
      functions.simplify({ simplifier: MeshoptSimplifier, ratio: MODEL_SIMPLIFY_ABOVE / triangles, error: 0.01 }),
      functions.prune({ keepLeaves: true }),
    );
    triangles = countTriangles(doc);
  }
  context.progress('compress', 0.3);
  await webpTextures(doc, extensions.EXTTextureWebP, context);
  throwIfAborted(context.signal);
  await doc.transform(functions.meshopt({ encoder: MeshoptEncoder, level: 'high' }));
  context.progress('compress', 0.9);
  const bytes = await io.writeBinary(doc);
  // Read from the bytes that are stored, so the check sees exactly what visitors can download.
  const partNames = glbNamesOf(bytes);
  context.progress('compress', 1);
  return { bytes, triangles, partNames, simplifiedFrom };
}

// ---------------------------------------------------------------------------------------------
// Check and poster
// ---------------------------------------------------------------------------------------------

/** Loads the converted GLB the way the site's viewer will; throws when it cannot. */
async function loadBack(bytes: Uint8Array): Promise<GLTF> {
  const { loader, dispose } = await createGltfLoader();
  try {
    return await loader.parseAsync(bytes.slice().buffer as ArrayBuffer, '');
  } finally {
    dispose();
  }
}

/** Draws the model once, 1600 x 1200 on a transparent background, and encodes it as WebP. */
async function renderPoster(THREE: Three, model: Object3D): Promise<Blob | null> {
  const { RoomEnvironment } = await import('three/examples/jsm/environments/RoomEnvironment.js');
  const width = MODEL_POSTER_WIDTH;
  const height = MODEL_POSTER_HEIGHT;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  let renderer: InstanceType<Three['WebGLRenderer']>;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  } catch {
    return null;
  }
  const scene = new THREE.Scene();
  try {
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(new THREE.Color(0, 0, 0), 0);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    const environment = pmrem.fromScene(room, 0.04);
    room.dispose();
    pmrem.dispose();
    scene.environment = environment.texture;
    scene.add(model);
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    if (box.isEmpty()) return null;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const radius = Math.max(sphere.radius, 1e-9);
    const vertical = (POSTER_FOV * Math.PI) / 180;
    const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * (width / height));
    const distance = (radius * 1.02) / Math.sin(Math.min(vertical, horizontal) / 2);
    const camera = new THREE.PerspectiveCamera(POSTER_FOV, width / height, distance / 100, distance * 10);
    camera.position.copy(sphere.center).addScaledVector(new THREE.Vector3(...HOME).normalize(), distance);
    camera.lookAt(sphere.center);
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    const raster = createRaster(width, height);
    try {
      raster.context.drawImage(canvas, 0, 0);
      return await encodeWebP(raster, { quality: POSTER_QUALITY });
    } finally {
      releaseRaster(raster);
      environment.dispose();
    }
  } finally {
    scene.remove(model);
    renderer.dispose();
    renderer.forceContextLoss();
  }
}

// ---------------------------------------------------------------------------------------------
// The whole preparation
// ---------------------------------------------------------------------------------------------

/**
 * Refuses a model over the 150 MB cap, its companion files counted, before anything is read: three's
 * loaders and glTF-Transform run on the page, where a larger model would freeze the admin or use
 * up its memory (ARCHITECTURE.md 11). STEP has its own cap in its worker (./step.ts).
 */
export function checkModelSize(group: { main: { name: string; size: number }; companions: readonly { size: number }[] }): void {
  const total = group.companions.reduce((sum, file) => sum + file.size, group.main.size);
  if (total > MODEL_MAX_BYTES) throw new PrepareError('model-too-large', group.main.name, M.modelTooLarge);
}

/** Prepares a model group: one compressed GLB, its poster, its triangle count, and its part names. */
export async function prepareModel(group: FileGroup, detected: Detected, context: PrepareContext): Promise<PreparedUpload> {
  const { main } = group;
  if (detected.format !== 'step') checkModelSize(group);
  context.progress('decode');
  const THREE = await import('three');
  const missing = new Set<string>();
  let loaded: Loaded;
  try {
    if (detected.format === 'step') {
      const { readStep } = await import('./step');
      loaded = { root: await readStep(main, THREE, context), animations: [] };
    } else {
      loaded = await loadWithThree(THREE, group, detected, context, missing);
    }
  } catch (error) {
    if (error instanceof PrepareError || isAbortError(error, context.signal)) throw error;
    if (missing.size > 0) throw new PrepareError('model-missing-file', main.name, M.modelMissingFiles([...missing]));
    throw new PrepareError('model-unreadable', main.name, M.modelUnreadable(detailOf(error)));
  }

  try {
    for (const name of missing) context.warn('model-missing-file', M.modelMissingFile(name));
    throwIfAborted(context.signal);
    if (!hasGeometry(loaded.root)) throw new PrepareError('model-empty', main.name, M.modelEmpty);
    standardizeMaterials(THREE, loaded.root);
    markNames(loaded);

    context.progress('convert');
    let optimized: Optimized;
    try {
      const glb = await exportGlb(loaded);
      throwIfAborted(context.signal);
      context.progress('compress', 0);
      optimized = await optimize(glb, context);
    } catch (error) {
      if (error instanceof PrepareError || isAbortError(error, context.signal)) throw error;
      throw new PrepareError('model-export-failed', main.name, M.modelExportFailed(detailOf(error)));
    }
    if (optimized.simplifiedFrom !== null) {
      context.warn('model-simplified', M.modelSimplified(optimized.simplifiedFrom, optimized.triangles));
    }
    if (optimized.triangles > MODEL_SIMPLIFY_ABOVE) context.warn('model-large', M.modelStillLarge(optimized.triangles));

    throwIfAborted(context.signal);
    context.progress('poster');
    let check: GLTF;
    try {
      check = await loadBack(optimized.bytes);
    } catch (error) {
      throw new PrepareError('model-check-failed', main.name, M.modelCheckFailed(detailOf(error)));
    }
    let poster: Blob | null = null;
    try {
      poster = await renderPoster(THREE, check.scene);
    } catch {
      poster = null;
    } finally {
      disposeObject(check.scene);
    }
    if (!poster) context.warn('no-poster', M.noModelPoster);

    const glb = new Blob([optimized.bytes as Uint8Array<ArrayBuffer>], { type: 'model/gltf-binary' });
    const parts: PreparedPart[] = [{ role: 'main', name: outputName(main.name, 'glb'), blob: glb, contentType: 'model/gltf-binary' }];
    if (poster) parts.push({ role: 'poster', name: posterName(main.name), blob: poster, contentType: 'image/webp' });
    return {
      kind: 'model',
      mediaKind: 'model',
      original: originalOf(main),
      parts,
      meta: {
        ...(poster ? { width: MODEL_POSTER_WIDTH, height: MODEL_POSTER_HEIGHT } : {}),
        triangles: optimized.triangles,
        partNames: optimized.partNames,
      },
      warnings: context.warnings,
    };
  } finally {
    disposeObject(loaded.root);
  }
}
