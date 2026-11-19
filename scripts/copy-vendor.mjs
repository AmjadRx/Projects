#!/usr/bin/env node
/**
 * Copies the decoder and viewer files that browsers load at run time from node_modules into
 * public/vendor/, so no viewer fetches code from a public CDN (docs/V3_PLAN.md 5.6). The folder
 * is generated and ignored by git; `npm run dev` and `npm run build` run this script first.
 *
 *   public/vendor/draco/   three.js Draco decoder for compressed glTF models (glTF build)
 *   public/vendor/docx/    docx-preview and JSZip, loaded only inside the sandboxed Word frame
 *   public/vendor/pdfjs/   the pdf.js worker, matched to the pdf.js version react-pdf pins
 *   public/vendor/occt/    occt-import-js (the Open CASCADE kernel in WebAssembly) and its two
 *                          licences, unmodified, loaded only by the admin's STEP worker
 *                          (public/admin-workers/occt-worker.js; docs/V3_PLAN.md D-81, Q-22)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modules = path.join(root, 'node_modules');
const out = path.join(root, 'public', 'vendor');

const COPIES = [
  { from: 'three/examples/jsm/libs/draco/gltf/draco_decoder.js', to: 'draco/draco_decoder.js' },
  { from: 'three/examples/jsm/libs/draco/gltf/draco_decoder.wasm', to: 'draco/draco_decoder.wasm' },
  { from: 'three/examples/jsm/libs/draco/gltf/draco_wasm_wrapper.js', to: 'draco/draco_wasm_wrapper.js' },
  { from: 'three/LICENSE', to: 'draco/LICENSE-three.txt' },
  { from: 'docx-preview/dist/docx-preview.min.js', to: 'docx/docx-preview.min.js' },
  { from: 'docx-preview/LICENSE', to: 'docx/LICENSE-docx-preview.txt' },
  { from: 'jszip/dist/jszip.min.js', to: 'docx/jszip.min.js' },
  { from: 'jszip/LICENSE.markdown', to: 'docx/LICENSE-jszip.md' },
  { from: 'react-pdf/node_modules/pdfjs-dist/build/pdf.worker.min.mjs', alt: 'pdfjs-dist/build/pdf.worker.min.mjs', to: 'pdfjs/pdf.worker.min.mjs' },
  { from: 'react-pdf/node_modules/pdfjs-dist/LICENSE', alt: 'pdfjs-dist/LICENSE', to: 'pdfjs/LICENSE-pdfjs.txt' },
  { from: 'occt-import-js/dist/occt-import-js.js', to: 'occt/occt-import-js.js' },
  { from: 'occt-import-js/dist/occt-import-js.wasm', to: 'occt/occt-import-js.wasm' },
  { from: 'occt-import-js/dist/license.occt-import-js.txt', to: 'occt/license.occt-import-js.txt' },
  { from: 'occt-import-js/dist/license.occt.txt', to: 'occt/license.occt.txt' },
];

/**
 * Whole folders: the pdf.js decoders for JPEG 2000 images and color profiles (WebAssembly, with
 * their licences) and the character maps some PDFs need for CJK text. The standard-fonts folder
 * is left out on purpose (docs/V3_PLAN.md 4.2): pages fall back to system fonts.
 */
const FOLDERS = [
  { from: 'pdfjs-dist/wasm', to: 'pdfjs/wasm' },
  { from: 'pdfjs-dist/cmaps', to: 'pdfjs/cmaps' },
  { from: 'pdfjs-dist/iccs', to: 'pdfjs/iccs' },
];

let copied = 0;
for (const item of COPIES) {
  const candidates = [item.from, item.alt].filter(Boolean).map((p) => path.join(modules, p));
  const source = candidates.find((p) => fs.existsSync(p));
  if (!source) {
    console.error(`copy-vendor: missing ${item.from}. Run npm install first.`);
    process.exit(1);
  }
  const target = path.join(out, item.to);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  copied += 1;
}
for (const folder of FOLDERS) {
  const source = path.join(modules, folder.from);
  if (!fs.existsSync(source)) {
    console.error(`copy-vendor: missing ${folder.from}. Run npm install first.`);
    process.exit(1);
  }
  const target = path.join(out, folder.to);
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(source, target, { recursive: true });
  copied += fs.readdirSync(target).length;
}
console.log(`copy-vendor: ${copied} files in public/vendor/`);
