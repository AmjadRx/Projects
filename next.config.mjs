import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

/**
 * The owner's exact Vercel Blob store host, for example `abc123.public.blob.vercel-storage.com`.
 * Never the shared Blob domain (docs/V3_PLAN.md D-29). BLOB_STORE_HOST names it; otherwise it is
 * worked out from the store id inside BLOB_READ_WRITE_TOKEN ("vercel_blob_rw_<storeId>_..."),
 * which is public anyway (every Blob file's address starts with it). The token itself is never
 * read into the bundle. When neither is set, Blob images are shown without the image optimizer.
 */
function blobStoreHost() {
  const explicit = (process.env.BLOB_STORE_HOST ?? '').trim().toLowerCase();
  if (/^[a-z0-9]+\.public\.blob\.vercel-storage\.com$/.test(explicit)) return explicit;
  const storeId = /^vercel_blob_rw_([A-Za-z0-9]+)_/.exec((process.env.BLOB_READ_WRITE_TOKEN ?? '').trim())?.[1];
  return storeId ? `${storeId.toLowerCase()}.public.blob.vercel-storage.com` : '';
}

const blobHost = blobStoreHost();
const blobOrigin = blobHost ? `https://${blobHost}` : '';
const isDev = process.env.NODE_ENV === 'development';
const onVercel = Boolean(process.env.VERCEL);
/** The Vercel Toolbar, which the owner sees on previews only (docs/V3_PLAN.md Q-32). */
const toolbar = process.env.VERCEL_ENV === 'preview';

/** Joins sources, dropping empty ones. */
function sources(...list) {
  return list.flat().filter(Boolean).join(' ');
}

/**
 * The site's Content-Security-Policy (ARCHITECTURE.md 11; docs/V3_PLAN.md D-35, R-13). Static, so
 * every public page stays static: no nonces, hence 'unsafe-inline' for Next's inline scripts and
 * the theme script. No 'unsafe-eval' outside development (Next's dev server needs it).
 * 'wasm-unsafe-eval' lets the viewers' decoders (Draco, Meshopt, pdf.js) and the admin's
 * converters compile WebAssembly; it does not allow JavaScript eval.
 *
 * The admin variant adds what browser uploads and conversion need: the Blob upload API on
 * vercel.com, and data: for three's loaders.
 */
function contentSecurityPolicy({ admin }) {
  return [
    "default-src 'self'",
    // In development, Vercel Analytics loads its debug script from va.vercel-scripts.com; on Vercel it is served from the site.
    `script-src ${sources("'self'", "'unsafe-inline'", "'wasm-unsafe-eval'", isDev && ["'unsafe-eval'", 'https://va.vercel-scripts.com'], toolbar && 'https://vercel.live')}`,
    `style-src ${sources("'self'", "'unsafe-inline'", toolbar && 'https://vercel.live')}`,
    `img-src ${sources("'self'", 'data:', 'blob:', blobOrigin, toolbar && ['https://vercel.live', 'https://vercel.com'])}`,
    `media-src ${sources("'self'", 'blob:', blobOrigin)}`,
    `font-src ${sources("'self'", 'data:', toolbar && ['https://vercel.live', 'https://assets.vercel.com'])}`,
    `connect-src ${sources(
      "'self'",
      'blob:',
      admin && ['data:', 'https://vercel.com'],
      blobOrigin,
      toolbar && ['https://vercel.live', 'wss://ws-us3.pusher.com'],
      isDev && 'ws:',
    )}`,
    "worker-src 'self' blob:",
    `frame-src ${sources("'self'", 'https://www.youtube-nocookie.com', 'https://player.vimeo.com', toolbar && 'https://vercel.live')}`,
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "manifest-src 'self'",
    onVercel && 'upgrade-insecure-requests',
  ]
    .filter(Boolean)
    .join('; ');
}

/**
 * Powerful browser features the site never uses are turned off; fullscreen stays for the site and
 * the two embed hosts (the model viewer and the video players), clipboard-write for the code
 * blocks' copy button.
 */
const permissionsPolicy = [
  'accelerometer=()',
  'autoplay=(self)',
  'bluetooth=()',
  'browsing-topics=()',
  'camera=()',
  'clipboard-write=(self)',
  'display-capture=()',
  'fullscreen=(self "https://www.youtube-nocookie.com" "https://player.vimeo.com")',
  'geolocation=()',
  'gyroscope=()',
  'hid=()',
  'magnetometer=()',
  'microphone=()',
  'midi=()',
  'payment=()',
  'publickey-credentials-get=()',
  'serial=()',
  'usb=()',
].join(', ');

const commonHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: permissionsPolicy },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
];

/**
 * Paths with a policy of their own, left out of the site-wide one, because a second policy on a
 * response is enforced too and would undo what the path needs:
 * - /admin: the admin variant above;
 * - /admin-workers/occt-worker.js: the STEP converter calls the Function constructor (D-81), so
 *   only its own worker may evaluate code; a dedicated worker takes its policy from its own
 *   response, and every page stays strict;
 * - /viewers/: the sandboxed Word frame, which the site's own pages embed (frame-ancestors 'self');
 *   its page carries the full script policy in a meta tag;
 * - /api/upload/file: the admin's media stream, which sets a sandboxing policy itself.
 */
// Anchored: only these exact paths (and the /viewers/ folder) leave the site-wide policy, so another
// file under /admin-workers/ or a path such as /api/upload/files keeps the strict one.
const SITE_WIDE = '/((?!admin(?:$|/)|admin-workers/occt-worker\\.js$|viewers/|api/upload/file$).*)';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // A separate output folder lets a test or a second dev server build beside the main one.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  experimental: {
    optimizePackageImports: ['lucide-react'],
    // Build-time only: code highlighting runs while pages are prerendered, never in a browser.
    // jsdom (with DOMPurify) sanitizes SVG uploads at run time; Node loads it as it ships.
    serverComponentsExternalPackages: ['shiki', 'jsdom'],
  },
  // Lets viewers send Blob photos through the image optimizer when the store host is known.
  env: { NEXT_PUBLIC_BLOB_STORE_HOST: blobHost },
  images: {
    remotePatterns: blobHost ? [{ protocol: 'https', hostname: blobHost, pathname: '/**' }] : [],
  },
  webpack(config, { isServer, webpack }) {
    if (!isServer) {
      /**
       * pdf.js 5 (through react-pdf 10) declares names that collide with the module wrapper of
       * Next 14's webpack, so browser bundles use its minified build, which holds the same code
       * and version. Remove this in Phase 1: Next 16 builds with Turbopack.
       */
      config.resolve.alias = {
        ...config.resolve.alias,
        'pdfjs-dist$': require.resolve('pdfjs-dist/build/pdf.min.mjs'),
        /**
         * @gltf-transform/functions imports ndarray-pixels, whose browser build loads ndarray-ops,
         * which builds functions from strings the moment it loads. The admin's policy refuses
         * that, so every model upload failed on the Phase 6 preview (a dev server allows it, which
         * is why only a production build shows it). The admin never reads or writes texture
         * pixels through glTF-Transform, so browser bundles get a stub that refuses both calls.
         */
        'ndarray-pixels$': fileURLToPath(new URL('./lib/admin/convert/ndarray-pixels-browser.js', import.meta.url)),
      };
      /**
       * @gltf-transform/core's NodeIO imports node:fs and node:path, which the admin's browser-side
       * model conversion never calls (it uses WebIO). Next 14's browser build cannot resolve the
       * node: scheme, so those two imports are dropped from browser bundles of that package only.
       */
      config.plugins.push(
        new webpack.IgnorePlugin({ resourceRegExp: /^node:(?:fs|path)$/, contextRegExp: /[\\/]@gltf-transform[\\/]core[\\/]/ }),
      );
    }
    return config;
  },
  async headers() {
    return [
      { source: '/:path*', headers: commonHeaders },
      { source: SITE_WIDE, headers: [{ key: 'Content-Security-Policy', value: contentSecurityPolicy({ admin: false }) }] },
      { source: '/admin', headers: [{ key: 'Content-Security-Policy', value: contentSecurityPolicy({ admin: true }) }] },
      { source: '/admin/:path*', headers: [{ key: 'Content-Security-Policy', value: contentSecurityPolicy({ admin: true }) }] },
      {
        source: '/admin-workers/occt-worker.js',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: "default-src 'self'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'; connect-src 'self'",
          },
        ],
      },
      // The sample page for testing the viewers is never indexed (removed before release).
      { source: '/dev/:path*', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] },
      // The isolated Word frame: never indexed, sandboxed even when opened on its own, and framed
      // only by this site's pages.
      {
        source: '/viewers/:path*',
        headers: [
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Content-Security-Policy', value: "sandbox allow-scripts; frame-ancestors 'self'; base-uri 'none'; object-src 'none'" },
        ],
      },
      // The site's fonts (scripts/subset-fonts.py): each file's name carries its content's hash, so
      // a browser may keep it for good, as it keeps Next's own hashed files.
      { source: '/fonts/:file*', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] },
      // An SVG opened on its own runs nothing (D-24). This rule comes after the site-wide one, so
      // its policy is the one sent for SVG files.
      {
        source: '/media/:path(.*\\.svg)',
        headers: [
          { key: 'Content-Security-Policy', value: "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox" },
        ],
      },
    ];
  },
};

export default nextConfig;
