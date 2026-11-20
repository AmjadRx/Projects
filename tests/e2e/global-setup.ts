/**
 * Before the first test, the image optimizer of the suite's own server is warmed: every address a
 * page can ask /_next/image for is fetched once, to its end, so no test's request is ever the
 * first one for its address.
 *
 * Why. `next start` (Next 14.2.15) makes each picture once per address (the source, the width, the
 * quality, and the format the browser accepts) and keeps it on disk, and every request for an
 * address being made waits for that one result. It reads the source file through the first
 * request's own connection (fetchInternalImage in next/dist/server/image-optimizer.js gives its
 * stand-in response that request's socket, and the file server stops reading once the socket has
 * closed). When the browser drops that first request before the source has been read, as it does
 * when a test closes its page while a large picture loads, the result never comes, and every later
 * request for that address waits for it until the server restarts. A curl alone shows it, with no
 * page involved: a first request for a 4.4 MB source dropped after 50 ms, then the next request
 * for the same address answers nothing in 30 s, while another width of the same source answers in
 * a quarter of a second. Chrome does it too when a page closes within about 10 ms of asking for
 * such a picture on a quiet machine, and a busy one widens that window. In one full run, four
 * console tests on /projects/raven waited 90 s for the network to go quiet while
 * /_next/image?url=%2Fmedia%2Fraven%2Fimg-7414.webp&w=256&q=75 never answered. Vercel answers
 * /_next/image with its own image service, so a visitor never meets this; the suite does, because
 * it serves the build with next start.
 *
 * Once an address is on disk, a request for it is answered from the disk at once: fresh, or, after
 * Next's minimumCacheTTL (60 s), stale while a new copy is made behind it. A dropped request can
 * then leave no other waiting.
 *
 * Which addresses: every source that the markup of any route (ROUTES, in both themes) sends
 * through the optimizer, at every width the optimizer allows (the served build's
 * images-manifest.json: a lightbox asks for whichever width fits the room it has), at each quality
 * the markup names, with the Accept header Chrome sends for a picture (the format it accepts is
 * part of the address). At most eight at a time: 224 addresses took 3 to 7 s here on an empty
 * cache (tests/e2e/serve.mjs empties it before it starts the server, so every run starts alike).
 *
 * Nothing is hidden. No page, request or console message of any test changes; an address the
 * optimizer cannot make stops the run here, with its name and status, and so does one that does
 * not answer in two minutes (it hangs already: restart the server). ./support/fixtures.ts fails
 * any test whose page got a picture the server made for it (X-Nextjs-Cache: MISS), an address
 * missed here, so a new source or width sent through the optimizer is named the first time.
 *
 * Against a deployment (E2E_BASE_URL) nothing is warmed: Vercel's image service is another
 * program, and every picture it makes is metered on the owner's plan.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FullConfig } from '@playwright/test';
import { imageConfigDefault } from 'next/dist/shared/lib/image-config';
import { ROUTES, THEME_COOKIE, THEMES } from './support/site';

/** The optimizer's path (next/image's default loader; next.config.mjs keeps it). */
const OPTIMIZER = '/_next/image';

/** The Accept header Chrome sends for a picture; the optimizer chooses the format from it. */
const PICTURE_ACCEPT = 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8';

/** An address still unanswered after this long hangs already. */
const HANG_MS = 120_000;

const root = path.resolve(__dirname, '..', '..');

/** The widths the optimizer allows: the served build's own list, or Next's defaults without it. */
function allowedWidths(): number[] {
  // The suite's output folder, as tests/e2e/serve.mjs names it.
  const manifest = path.resolve(root, process.env.E2E_DIST_DIR || '.next-e2e', 'images-manifest.json');
  try {
    const sizes = (JSON.parse(fs.readFileSync(manifest, 'utf8')) as { images?: { sizes?: unknown } }).images?.sizes;
    if (Array.isArray(sizes) && sizes.length > 0 && sizes.every((size) => Number.isInteger(size))) {
      return [...new Set(sizes as number[])].sort((a, b) => a - b);
    }
  } catch {
    // No build there (a server started elsewhere, E2E_REUSE_SERVER): Next's defaults, which
    // next.config.mjs keeps.
  }
  console.log(`e2e: no image sizes in ${path.relative(root, manifest)}; warming Next's default widths`);
  return [...new Set([...imageConfigDefault.deviceSizes, ...imageConfigDefault.imageSizes])].sort((a, b) => a - b);
}

/** Every source and quality the routes' markup, in each theme, sends through the optimizer. */
async function optimizedInMarkup(baseURL: string): Promise<{ sources: string[]; qualities: string[] }> {
  const sources = new Set<string>();
  const qualities = new Set<string>();
  for (const theme of THEMES) {
    for (const route of ROUTES) {
      const response = await fetch(new URL(route.path, baseURL), { headers: { cookie: `${THEME_COOKIE}=${theme}` } });
      // Attributes write & as &amp;, and the page's own data (the scripts) as &.
      const markup = (await response.text()).replace(/&amp;|\\u0026/g, '&');
      for (const [address] of markup.matchAll(/\/_next\/image\?[^"'\s,\\<>]+/g)) {
        const params = new URL(address, baseURL).searchParams;
        const source = params.get('url');
        const quality = params.get('q');
        if (source) sources.add(source);
        if (quality) qualities.add(quality);
      }
    }
  }
  return { sources: [...sources].sort(), qualities: [...qualities].sort() };
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  if (process.env.E2E_BASE_URL?.trim()) return;
  const baseURL = config.projects.find((project) => project.use.baseURL)?.use.baseURL;
  if (!baseURL) throw new Error('e2e: no baseURL to warm the image optimizer at (playwright.config.ts sets one)');

  const started = performance.now();
  const widths = allowedWidths();
  const { sources, qualities } = await optimizedInMarkup(baseURL);
  const addresses = sources.flatMap((source) =>
    widths.flatMap((width) => qualities.map((quality) => `${OPTIMIZER}?url=${encodeURIComponent(source)}&w=${width}&q=${quality}`)),
  );

  const answers = new Map<string, number>();
  const failures: string[] = [];
  let next = 0;
  const lane = async () => {
    while (next < addresses.length) {
      const address = addresses[next++];
      try {
        const response = await fetch(new URL(address, baseURL), { headers: { accept: PICTURE_ACCEPT }, signal: AbortSignal.timeout(HANG_MS) });
        // To its end: a request dropped early is the very fault this warm-up keeps the tests from.
        await response.arrayBuffer();
        if (response.status !== 200) failures.push(`${address}: ${response.status} ${response.statusText}`);
        const answer = response.headers.get('x-nextjs-cache') ?? 'no cache header';
        answers.set(answer, (answers.get(answer) ?? 0) + 1);
      } catch (error) {
        const timedOut = error instanceof Error && error.name === 'TimeoutError';
        failures.push(`${address}: ${timedOut ? `no answer in ${HANG_MS / 1000} s` : error instanceof Error ? error.message : String(error)}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, os.availableParallelism(), addresses.length) }, lane));

  if (failures.length > 0) {
    throw new Error(
      `e2e: the image optimizer at ${baseURL} could not be warmed, so the run stops before its first test:\n  ${failures.join('\n  ')}`,
    );
  }
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  const counts = [...answers].map(([answer, count]) => `${count} ${answer}`).join(', ');
  console.log(
    `e2e: image optimizer warmed in ${seconds} s: ${addresses.length} addresses (${sources.length} sources, ${widths.length} widths, quality ${qualities.join(' and ') || 'none'}): ${counts || 'none'}`,
  );
}
