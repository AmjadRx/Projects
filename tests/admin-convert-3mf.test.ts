/**
 * A textured 3MF through the real model conversion (lib/admin/convert/model.ts), under Node with
 * stand-ins for what a browser gives: jsdom's DOMParser for the 3MF XML, an <img> that loads a
 * moment later (as a browser loads a blob: URL, on a later task), a 2D canvas for GLTFExporter,
 * createImageBitmap, and the WebP encoder (./webp.ts needs a real canvas). WebGL is missing, so
 * there is no poster, as in a browser without it.
 *
 * Regression of the Phase 6 review (CONVERT-7): the 3MF branch exported before its textures had
 * loaded, so a textured 3MF was refused, every time once the exporter's module was cached.
 */
import { WebIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { JSDOM } from 'jsdom';
import JSZip from 'jszip';
import { MeshoptDecoder } from 'meshoptimizer/decoder';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prepareModel } from '@/lib/admin/convert/model';
import { createContext } from '@/lib/admin/convert/util';

vi.mock('@/lib/admin/convert/webp', () => {
  // A 1 x 1 lossy WebP.
  const webp = Uint8Array.from(atob('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA'), (c) => c.charCodeAt(0));
  return {
    createRaster: (width: number, height: number) => ({ width, height, context: { drawImage: () => undefined } }),
    drawScaled: (_source: unknown, width: number, height: number) => ({ width, height, context: {} }),
    encodeWebP: async () => new Blob([webp], { type: 'image/webp' }),
    releaseRaster: () => undefined,
  };
});

/**
 * A 2 x 2 PNG of four colors (red, green, blue, white). One of a single color would be folded into
 * the material's color by glTF-Transform's prune, and leave no texture to look for.
 */
const PNG_2X2 = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGP4z8DAAMIM/////w8AH+4F+7C4l8kAAAAASUVORK5CYII='),
  (c) => c.charCodeAt(0),
);

/** How long the stand-in <img> takes to load: long enough that an export that does not wait runs first. */
const IMAGE_LOAD_MS = 25;

class ImageStandIn {
  width = 2;
  height = 2;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private listeners: Record<string, ((this: ImageStandIn) => void)[]> = {};
  addEventListener(type: string, listener: (this: ImageStandIn) => void) {
    (this.listeners[type] ??= []).push(listener);
  }
  removeEventListener(type: string, listener: (this: ImageStandIn) => void) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((each) => each !== listener);
  }
  set src(_url: string) {
    setTimeout(() => {
      for (const listener of (this.listeners.load ?? []).slice()) listener.call(this);
      this.onload?.();
    }, IMAGE_LOAD_MS);
  }
}

/** `new Image()`, which only GLTFLoader's WebP probe uses: its 1 x 1 test picture loads. */
class WebPProbeStandIn {
  height = 0;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(_url: string) {
    setTimeout(() => {
      this.height = 1;
      this.onload?.();
    }, 0);
  }
}

class CanvasStandIn {
  width = 0;
  height = 0;
  addEventListener() {}
  removeEventListener() {}
  getContext(kind: string) {
    if (kind !== '2d') return null; // no WebGL: no poster
    return { translate() {}, scale() {}, drawImage() {}, putImageData() {} };
  }
  toBlob(done: (blob: Blob) => void, type: string) {
    done(new Blob([PNG_2X2], { type }));
  }
}

class FileReaderStandIn {
  result: ArrayBuffer | null = null;
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

const STAND_INS: Record<string, unknown> = {
  // GLTFLoader makes blob: URLs for embedded images through self.URL.
  self: globalThis,
  DOMParser: new JSDOM('').window.DOMParser,
  HTMLImageElement: ImageStandIn,
  Image: WebPProbeStandIn,
  FileReader: FileReaderStandIn,
  createImageBitmap: async () => ({ width: 2, height: 2, close: () => undefined }),
  document: {
    createElementNS: (_ns: string, name: string) => {
      if (name !== 'img') throw new Error(`unexpected element ${name}`);
      return new ImageStandIn();
    },
    createElement: (name: string) => {
      if (name !== 'canvas') throw new Error(`unexpected element ${name}`);
      return new CanvasStandIn();
    },
  },
};
const globals = globalThis as unknown as Record<string, unknown>;
const saved: Record<string, unknown> = {};
beforeAll(() => {
  for (const [key, value] of Object.entries(STAND_INS)) {
    saved[key] = globals[key];
    globals[key] = value;
  }
  // WebGL's absence is reported on the console; the conversion carries on without a poster.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterAll(() => {
  for (const key of Object.keys(STAND_INS)) globals[key] = saved[key];
  vi.restoreAllMocks();
});

/** A 3MF plate with one triangle, colored by a PNG texture. */
async function textured3mf(): Promise<Uint8Array<ArrayBuffer>> {
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
 <resources>
  <texture2d id="1" path="/3D/Texture/tex.png" contenttype="image/png"/>
  <texture2dgroup id="2" texid="1"><tex2coord u="0" v="0"/><tex2coord u="1" v="0"/><tex2coord u="0" v="1"/></texture2dgroup>
  <object id="3" type="model" pid="2" pindex="0" name="Plate">
   <mesh>
    <vertices><vertex x="0" y="0" z="0"/><vertex x="10" y="0" z="0"/><vertex x="0" y="10" z="0"/></vertices>
    <triangles><triangle v1="0" v2="1" v3="2" p1="0" p2="1" p3="2"/></triangles>
   </mesh>
  </object>
 </resources>
 <build><item objectid="3"/></build>
</model>`;
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  zip.file(
    '_rels/.rels',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>',
  );
  zip.file(
    '3D/_rels/3dmodel.model.rels',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/Texture/tex.png" Id="rel1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dtexture"/></Relationships>',
  );
  zip.file('3D/3dmodel.model', model);
  zip.file('3D/Texture/tex.png', PNG_2X2);
  return new Uint8Array(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }));
}

async function convert(name: string) {
  const file = new File([await textured3mf()], name);
  const upload = await prepareModel({ main: file, companions: [] }, { format: '3mf', ext: '3mf' }, createContext(name));
  await MeshoptDecoder.ready;
  const io = new WebIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
  const stored = await io.readBinary(new Uint8Array(await upload.parts[0].blob.arrayBuffer()));
  return { upload, stored };
}

describe('a textured 3MF (CONVERT-7)', () => {
  // The first model of a session loads the exporter's module; any later one finds it cached.
  for (const [label, name] of [
    ['as the first model of a session', 'plate.3mf'],
    ['as a later model, with the exporter already loaded', 'plate-again.3mf'],
  ] as const) {
    it(`keeps its texture ${label}`, async () => {
      const { upload, stored } = await convert(name);
      expect(upload.parts[0]).toMatchObject({ role: 'main', contentType: 'model/gltf-binary' });
      expect(upload.meta.triangles).toBe(1);
      const textures = stored.getRoot().listTextures();
      expect(textures).toHaveLength(1);
      expect(textures[0].getMimeType()).toBe('image/webp');
      const material = stored.getRoot().listMaterials()[0];
      expect(material.getBaseColorTexture()).toBe(textures[0]);
    }, 60_000);
  }
});
