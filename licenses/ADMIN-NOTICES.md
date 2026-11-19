# Notices for the admin's file converters

The admin (`/admin`) prepares uploads in the owner's browser with the libraries below. They load
only inside the admin, only when a file needs them, and never for visitors. Each is used as
published, unmodified.

## Covered by the GNU Lesser General Public License

| library | version | licence | what it does here | source |
|---|---|---|---|---|
| occt-import-js | 0.0.23 | LGPL-2.1 (with the Open CASCADE exception, for the Open CASCADE Technology it is built from) | Reads STEP files in a dedicated worker (`public/admin-workers/occt-worker.js`) | https://github.com/kovacsv/occt-import-js |
| libheif-js | 1.23.5 | LGPL-3.0 | Decodes HEIC photos when the browser cannot | https://github.com/catdad-experiments/libheif-js |
| @mediabunny/aac-encoder | 1.66.0 | MPL-2.0, bundling FFmpeg's AAC encoder (LGPL-2.1 or later) | Encodes AAC audio when the browser cannot | https://github.com/Vanilagy/mediabunny |

These libraries ship as separate files that the browser loads at run time (`public/vendor/occt/`,
and the admin's own chunks for the other two), so they can be replaced with a modified build of
the same version without changing the rest of the site. Their licence texts travel with them:
`public/vendor/occt/` holds occt-import-js's and Open CASCADE's (copied by
`scripts/copy-vendor.mjs`), and the npm packages hold theirs.

## Other licences

| library | version | licence |
|---|---|---|
| mediabunny | 1.66.0 | MPL-2.0 |
| @gltf-transform/core, /extensions, /functions | 4.5.1 | MIT |
| meshoptimizer | 1.3.0 | MIT |
| @jsquash/webp | 1.5.0 | Apache-2.0 |
| file-type | 22.3.0 | MIT |
| dompurify | 3.4.18 | MPL-2.0 or Apache-2.0 (Apache-2.0 chosen) |
| jsdom (server only) | 31.0.1 | MIT |
