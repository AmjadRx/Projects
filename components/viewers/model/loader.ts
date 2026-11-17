/**
 * Loads GLB and glTF files. Every decoder is a local file (docs/V3_PLAN.md 5.6, "drei helpers"):
 * Draco from /vendor/draco/ (copied from three by scripts/copy-vendor.mjs) and Meshopt from the
 * decoder module bundled with three. Nothing is fetched from a CDN. KTX2 textures are not
 * supported (D-81): model textures are WebP.
 */
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

const DRACO_PATH = '/vendor/draco/';

let draco: DRACOLoader | null = null;
const cache = new Map<string, Promise<GLTF>>();

function createLoader(): GLTFLoader {
  if (!draco) {
    draco = new DRACOLoader();
    draco.setDecoderPath(DRACO_PATH);
    draco.setDecoderConfig({ type: 'wasm' });
    draco.setWorkerLimit(2);
  }
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  loader.setMeshoptDecoder(MeshoptDecoder);
  return loader;
}

/**
 * One request per file for the life of the page: a second viewer of the same file, or a viewer
 * resumed after it was suspended, reuses the parsed model. A failed load is forgotten, so a later
 * attempt tries again.
 */
export function loadModel(src: string): Promise<GLTF> {
  let pending = cache.get(src);
  if (!pending) {
    pending = createLoader().loadAsync(src);
    cache.set(src, pending);
    pending.catch(() => cache.delete(src));
  }
  return pending;
}
