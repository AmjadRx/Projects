/**
 * Groups the files the owner dropped together (ARCHITECTURE.md 13A): a .gltf with the .bin files
 * and textures it names, and an .obj with its .mtl files and the textures they name, become one
 * upload each, so the model can be read and converted to one GLB. Every other file is its own
 * group. A file only joins a model when the model names it, so photos dropped beside a model stay
 * photos; a companion nobody names stays alone, and detection then says what it is.
 */
import type { FileGroup } from './types';
import { extOf, matchKey } from './util';

/** The most of a .gltf file that is parsed for its references (larger ones embed their data). */
const GLTF_READ_MAX = 64 * 1024 * 1024;
/** `mtllib` lines sit at the top of an .obj file; only this much of it is read for them. */
const OBJ_HEAD_BYTES = 1024 * 1024;
const MTL_READ_MAX = 4 * 1024 * 1024;

/** Every external file a glTF document names (buffers and images), as written in its URIs. */
export function gltfReferences(json: unknown): string[] {
  if (!json || typeof json !== 'object') return [];
  const doc = json as { buffers?: unknown; images?: unknown };
  const out: string[] = [];
  for (const list of [doc.buffers, doc.images]) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const uri = item && typeof item === 'object' ? (item as { uri?: unknown }).uri : undefined;
      if (typeof uri === 'string' && uri.trim() && !/^data:/i.test(uri.trim())) out.push(uri.trim());
    }
  }
  return out;
}

/** The material libraries an .obj file names on its `mtllib` lines. */
export function objMaterialLibraries(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*mtllib\s+(.+?)\s*$/.exec(line);
    if (!match) continue;
    // Several libraries may share a line; a name with spaces cannot be told apart from two names,
    // so the whole rest of the line is offered too.
    const rest = match[1];
    out.push(rest);
    for (const part of rest.split(/\s+/)) if (part && part !== rest) out.push(part);
  }
  return out;
}

/** MTL statements that name a texture file. */
const MTL_MAPS = new Set([
  'map_ka',
  'map_kd',
  'map_ks',
  'map_ke',
  'map_ns',
  'map_d',
  'map_bump',
  'bump',
  'disp',
  'decal',
  'refl',
  'norm',
  'map_pr',
  'map_pm',
  'map_ps',
  'map_rma',
  'map_orm',
]);

/** How many values each MTL texture option takes (the -o, -s, and -t options take one to three). */
const MTL_OPTIONS: Readonly<Record<string, number>> = {
  '-blendu': 1,
  '-blendv': 1,
  '-boost': 1,
  '-mm': 2,
  '-o': 3,
  '-s': 3,
  '-t': 3,
  '-texres': 1,
  '-clamp': 1,
  '-bm': 1,
  '-imfchan': 1,
  '-type': 1,
  '-cc': 1,
};

/** The texture files an .mtl file names, options removed ("map_Kd -s 2 2 wood.png" gives "wood.png"). */
export function mtlTextureReferences(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const tokens = line.trim().split(/\s+/);
    if (tokens.length < 2 || !MTL_MAPS.has(tokens[0].toLowerCase())) continue;
    let i = 1;
    while (i < tokens.length - 1 && tokens[i].startsWith('-')) {
      const takes = MTL_OPTIONS[tokens[i].toLowerCase()] ?? 1;
      i += 1;
      // Options with up to three values stop at the first value that is not a number.
      let taken = 0;
      while (taken < takes && i < tokens.length - 1 && (takes === 1 || /^-?\d*\.?\d+(e-?\d+)?$/i.test(tokens[i]))) {
        i += 1;
        taken += 1;
      }
    }
    const name = tokens.slice(i).join(' ');
    if (name) out.push(name);
  }
  return out;
}

async function readText(file: File, max: number): Promise<string> {
  return file.size > max ? file.slice(0, max).text() : file.text();
}

/** The dropped files a set of references names, matched by their last segment, without case. */
function resolve(references: readonly string[], byKey: ReadonlyMap<string, File[]>, self: File): File[] {
  const out: File[] = [];
  for (const reference of references) {
    for (const file of byKey.get(matchKey(reference)) ?? []) {
      if (file !== self && !out.includes(file)) out.push(file);
    }
  }
  return out;
}

/**
 * Groups dropped files into uploads, in the order the main files were dropped. Reading a model's
 * references can fail (a .gltf that is not JSON); the model then has no companions, and reading
 * it later reports the problem.
 */
export async function groupFiles(files: readonly File[]): Promise<FileGroup[]> {
  const byKey = new Map<string, File[]>();
  for (const file of files) {
    const key = matchKey(file.name);
    const list = byKey.get(key);
    if (list) list.push(file);
    else byKey.set(key, [file]);
  }

  const companions = new Map<File, File[]>();
  for (const file of files) {
    const ext = extOf(file.name);
    if (ext === 'gltf') {
      let references: string[] = [];
      if (file.size <= GLTF_READ_MAX) {
        try {
          references = gltfReferences(JSON.parse(await file.text()));
        } catch {
          references = [];
        }
      }
      companions.set(file, resolve(references, byKey, file));
    } else if (ext === 'obj') {
      let libraries: string[] = [];
      try {
        libraries = objMaterialLibraries(await readText(file, OBJ_HEAD_BYTES));
      } catch {
        libraries = [];
      }
      let mtls = resolve(libraries, byKey, file).filter((candidate) => extOf(candidate.name) === 'mtl');
      // An .obj that names no library still gets the .mtl of the same base name, which the
      // loader then applies by the material names the .obj uses.
      if (mtls.length === 0) {
        const sameBase = matchKey(file.name).replace(/\.obj$/, '.mtl');
        mtls = (byKey.get(sameBase) ?? []).filter((candidate) => candidate !== file);
      }
      const textures: File[] = [];
      for (const mtl of mtls) {
        try {
          for (const texture of resolve(mtlTextureReferences(await readText(mtl, MTL_READ_MAX)), byKey, file)) {
            if (!textures.includes(texture) && !mtls.includes(texture)) textures.push(texture);
          }
        } catch {
          // An unreadable .mtl adds no textures; the loader reports it.
        }
      }
      companions.set(file, [...mtls, ...textures]);
    }
  }

  const taken = new Set<File>();
  for (const list of companions.values()) for (const file of list) taken.add(file);

  const groups: FileGroup[] = [];
  for (const file of files) {
    const own = companions.get(file);
    if (own) groups.push({ main: file, companions: own });
    else if (!taken.has(file)) groups.push({ main: file, companions: [] });
  }
  return groups;
}
