/*
 * The admin's STEP converter (docs/V3_PLAN.md D-81, Q-22), a classic worker that
 * lib/admin/convert/step.ts starts once per STEP file and terminates when it answers, after
 * 120 seconds, or when the owner cancels.
 *
 * It runs occt-import-js 0.0.23, the WebAssembly build of the Open CASCADE kernel (LGPL-2.1 with
 * the Open CASCADE exception; the licences sit beside it in /vendor/occt/, copied there unmodified
 * by scripts/copy-vendor.mjs). Its bindings build functions from strings, which a policy without
 * 'unsafe-eval' blocks, so this file alone is served with its own policy that allows it; every
 * page keeps the strict one.
 *
 * In:  { bytes: ArrayBuffer, params: { linearUnit, linearDeflectionType, linearDeflection, angularDeflection } }
 * Out: { ok: true, root, meshes } with typed arrays (transferred), or { ok: false, code, message }
 *      where code is 'blocked' (the kernel could not start), 'unreadable', or 'complex' (out of memory).
 */
'use strict';

var kernel = null;

function loadKernel() {
  if (!kernel) {
    importScripts('/vendor/occt/occt-import-js.js');
    // eslint-disable-next-line no-undef
    kernel = occtimportjs({
      locateFile: function () {
        return '/vendor/occt/occt-import-js.wasm';
      },
    });
  }
  return kernel;
}

function color(value) {
  return Array.isArray(value) && value.length >= 3 ? [Number(value[0]), Number(value[1]), Number(value[2])] : null;
}

function node(value, depth) {
  var children = [];
  if (depth < 64 && value && Array.isArray(value.children)) {
    for (var i = 0; i < value.children.length; i += 1) children.push(node(value.children[i], depth + 1));
  }
  return {
    name: value && typeof value.name === 'string' ? value.name : '',
    meshes: value && Array.isArray(value.meshes) ? value.meshes.slice() : [],
    children: children,
  };
}

function reply(result) {
  var transfer = [];
  var meshes = [];
  for (var i = 0; i < result.meshes.length; i += 1) {
    var source = result.meshes[i];
    var positions = new Float32Array(source.attributes.position.array);
    var normals = source.attributes.normal ? new Float32Array(source.attributes.normal.array) : null;
    var indices = new Uint32Array(source.index.array);
    var faces = [];
    var brep = Array.isArray(source.brep_faces) ? source.brep_faces : [];
    for (var f = 0; f < brep.length; f += 1) {
      faces.push({ first: brep[f].first, last: brep[f].last, color: color(brep[f].color) });
    }
    transfer.push(positions.buffer, indices.buffer);
    if (normals) transfer.push(normals.buffer);
    meshes.push({
      name: typeof source.name === 'string' ? source.name : '',
      color: color(source.color),
      positions: positions,
      normals: normals,
      indices: indices,
      faces: faces,
    });
  }
  self.postMessage({ ok: true, root: node(result.root, 0), meshes: meshes }, transfer);
}

self.onmessage = function (event) {
  var data = event.data || {};
  var started;
  try {
    started = loadKernel();
  } catch (error) {
    self.postMessage({ ok: false, code: 'blocked', message: String((error && error.message) || error) });
    return;
  }
  Promise.resolve(started)
    .then(
      function (occt) {
        var result;
        try {
          result = occt.ReadStepFile(new Uint8Array(data.bytes), data.params || null);
        } catch (error) {
          var text = String((error && error.message) || error);
          var complex = /memory|OOM|Aborted/i.test(text);
          self.postMessage({ ok: false, code: complex ? 'complex' : 'unreadable', message: text });
          return;
        }
        if (!result || !result.success || !Array.isArray(result.meshes)) {
          self.postMessage({ ok: false, code: 'unreadable', message: 'The kernel could not read the file.' });
          return;
        }
        reply(result);
      },
      function (error) {
        self.postMessage({ ok: false, code: 'blocked', message: String((error && error.message) || error) });
      },
    );
};
