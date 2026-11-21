// The browser stand-in for ndarray-pixels (aliased in next.config.mjs, browser bundles only).
// glTF-Transform's functions import ndarray-pixels, whose browser build loads ndarray-ops, which
// builds functions from strings as soon as it loads; the admin's policy refuses that, so every
// model upload failed on the Phase 6 preview. The admin's model pipeline never reads or writes
// texture pixels through glTF-Transform: prune() reads them only to find single-color textures,
// inside a try/catch that keeps the texture when reading fails. Both calls refuse.
export function getPixels() {
  return Promise.reject(new Error('Texture pixels are not read in the admin.'));
}

export function savePixels() {
  return Promise.reject(new Error('Texture pixels are not written in the admin.'));
}
