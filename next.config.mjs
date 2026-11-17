import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** @type {import('next').NextConfig} */
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

/**
 * The owner's exact Vercel Blob store host, for example `abc123.public.blob.vercel-storage.com`.
 * Never the shared Blob domain (docs/V3_PLAN.md D-29). When it is unset, Blob images are shown
 * without the image optimizer.
 */
const blobHost = process.env.BLOB_STORE_HOST?.trim() ?? '';

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // A separate output folder lets a test or a second dev server build beside the main one.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  experimental: {
    optimizePackageImports: ['lucide-react'],
    // Build-time only: code highlighting runs while pages are prerendered, never in a browser.
    serverComponentsExternalPackages: ['shiki'],
  },
  // Lets viewers send Blob photos through the image optimizer when the store host is set.
  env: { NEXT_PUBLIC_BLOB_STORE_HOST: blobHost },
  images: {
    remotePatterns: blobHost ? [{ protocol: 'https', hostname: blobHost, pathname: '/**' }] : [],
  },
  /**
   * pdf.js 5 (through react-pdf 10) declares names that collide with the module wrapper of
   * Next 14's webpack, so browser bundles use its minified build, which holds the same code and
   * version. Remove this in Phase 1: Next 16 builds with Turbopack.
   */
  webpack(config, { isServer }) {
    if (!isServer) {
      config.resolve.alias = {
        ...config.resolve.alias,
        'pdfjs-dist$': require.resolve('pdfjs-dist/build/pdf.min.mjs'),
      };
    }
    return config;
  },
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      // The sample page for testing the viewers is never indexed (removed before release).
      { source: '/dev/:path*', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] },
      // The isolated Word frame: never indexed, and sandboxed even when opened on its own.
      {
        source: '/viewers/:path*',
        headers: [
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'Content-Security-Policy', value: 'sandbox allow-scripts' },
        ],
      },
    ];
  },
};

export default nextConfig;
