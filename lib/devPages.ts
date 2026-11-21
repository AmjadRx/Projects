/**
 * The development pages (/dev/blocks, /dev-convert, /dev-media, /dev-sky) are for testing and never
 * ship to production (ARCHITECTURE.md 14, Phase 3: "removed before release"): a production
 * deployment answers not found for each of them, while local development and preview deployments,
 * where they help testing, keep them.
 *
 * Vercel sets VERCEL_ENV ("production", "preview", or "development" under `vercel dev`) at build
 * time and at run time. NODE_ENV cannot tell the deployments apart: it is "production" in every
 * `next build`, previews included. Anywhere else (a local production build, CI, the build tests)
 * the pages are off, so a build that does not say where it runs fails closed.
 *
 * Each page calls notFound() when this is false: /dev/blocks is prerendered, so its answer is fixed
 * when the deployment builds; the other three render on request.
 */
export function devPagesEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  const vercel = env.VERCEL_ENV?.trim();
  if (vercel) return vercel === 'preview' || vercel === 'development';
  return env.NODE_ENV === 'development';
}
