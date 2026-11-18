#!/usr/bin/env node
/**
 * Renders the sky's still images (Phase 5 brief, decision 7; docs/V3_PLAN.md 5.7, "Still and live
 * sky", and D-68) into public/sky/still/, for `npm run render:stills -- --base <url>`.
 *
 * The stills are drawn by the live scene itself: the script drives the sky's harness (/dev-sky,
 * app/dev-sky/page.tsx) in Chrome through Playwright and calls the scene's renderStill(time), so a
 * still is the frame the live sky draws at that moment (no parallax, meteor, shimmer or labels;
 * scroll progress 0; ground phase 0). The harness only exists under `next dev` (it is notFound in
 * production), so --base must point at a running dev server.
 *
 * - Width classes: skyFiles.stills in lib/motion.ts gives each class's size in CSS px, its device
 *   pixel ratio, the tier it is drawn on and its byte budget.
 * - Blueprint: one still for each of the 24 hourly sidereal steps (lib/sky/still-steps.ts), drawn
 *   at stepTimeNear(step, PREVIEW_MS), the moment nearest a fixed date whose sidereal time is the
 *   step's, so a run is repeatable: the scene depends on the clock only through the sidereal time.
 *   Files: blueprint-<class>-<step>.webp, the names lib/theme.ts gives the head script.
 * - Whiteprint: one still for each class, transparent above the horizon (WebP with alpha), so the
 *   paper's flat grid shows through it as it does through the live scene. Files:
 *   whiteprint-<class>.webp, the names app/sheet.css section 23 asks for.
 * - Encoding: WebP from the scene's canvas in the page (canvas.toBlob), at the highest quality in
 *   whole percent that fits the class's budget, never under skyFiles.minQuality.
 * - Checks, on every still, between the encoded image (decoded again in the page) and the frame it
 *   came from: every star brighter than magnitude 5 that the scene draws (placed with the scene's
 *   own placeStar) must keep its contrast above the sky around it; the same count is reported for
 *   every star drawn. Whiteprint's alpha must survive. A still that misses its budget, its quality
 *   floor or these checks makes the run exit 1 (the files are still written, to look at).
 *
 * Usage:
 *   node scripts/render-stills.mjs --base http://localhost:3270
 *     [--only <name prefix>[,<name prefix>]]   only the stills whose file name starts so, e.g.
 *                                               blueprint-phone or whiteprint
 *     [--out <directory>]                       instead of public/sky/still
 *     [--set <class>.<key>=<value>]             tries another size, ratio or tier for a class
 *                                               (repeatable); check:sky then fails on the size
 *     [--report <file.json>]                    every still's numbers as JSON
 *     [--browser chrome|chromium] [--executable <path>] [--headed]
 */
import fs from 'node:fs';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 18)) {
  console.error(`render:stills needs Node 22.18 or newer to load lib/*.ts directly (this is ${process.versions.node}).`);
  process.exit(1);
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT_URL = pathToFileURL(`${ROOT}${path.sep}`);

/**
 * Lets Node load the site's TypeScript modules as the bundler does: `@/` is the repository root,
 * and an import without an extension is the .ts file (or the folder's index.ts).
 */
registerHooks({
  resolve(specifier, context, nextResolve) {
    const spec = specifier.startsWith('@/') ? new URL(specifier.slice(2), ROOT_URL).href : specifier;
    try {
      return nextResolve(spec, context);
    } catch (error) {
      if (!/^(\.{1,2}\/|file:)/.test(spec) || /\.[cm]?[jt]sx?$/.test(spec)) throw error;
      for (const ending of ['.ts', '/index.ts']) {
        try {
          return nextResolve(`${spec}${ending}`, context);
        } catch {
          // Try the next ending.
        }
      }
      throw error;
    }
  },
});

const load = (file) => import(new URL(file, ROOT_URL).href);
const { SKY, skyFiles } = await load('lib/motion.ts');
const { PREVIEW_MS, STILL_STEPS, stepTimeNear, stillStepAt } = await load('lib/sky/still-steps.ts');
const { STILL_CLASSES, STILL_DIR, blueprintStillUrl } = await load('lib/theme.ts');
const { lstDeg } = await load('lib/sky/astro.ts');
const { countBrighterThan, decodeStars } = await load('lib/sky/stars.ts');
const { placeStar, starRadius } = await load('components/sky/live/math.ts');

// ---------------------------------------------------------------------------------------------
// The checks' own thresholds (how the encoded still is judged, not numbers of the sky)
// ---------------------------------------------------------------------------------------------

/** Stars brighter than this catalogue magnitude must survive the encoding. */
const BRIGHT = 5;
/** A star counts in the check when its peak stands at least this many levels (of 255) above the sky around it in the frame. */
const VISIBLE_LEVELS = 4;
/** Lost: the WebP keeps under this share of the star's contrast. Dimmed: under DIMMED_BELOW. */
const LOST_BELOW = 0.25;
const DIMMED_BELOW = 0.5;
/** The worst stars listed for each still in the report. */
const WORST_LISTED = 5;

// ---------------------------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------------------------

function argValues(name) {
  const out = [];
  process.argv.forEach((arg, i) => {
    if (arg === name && i + 1 < process.argv.length) out.push(process.argv[i + 1]);
  });
  return out;
}
const arg = (name) => argValues(name).at(-1);
const flag = (name) => process.argv.includes(name);

const base = arg('--base');
if (!base) {
  console.error('Usage: node scripts/render-stills.mjs --base <url of a running next dev server> [--only <prefix>] [--out <dir>] [--report <file>]');
  process.exit(1);
}
const outDir = path.resolve(arg('--out') ?? path.join(ROOT, 'public', ...STILL_DIR.split('/').filter(Boolean)));
const only = (arg('--only') ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const reportFile = arg('--report');

/** The width classes, with any --set overrides (a class key and a number or a word). */
const classes = Object.fromEntries(STILL_CLASSES.map((name) => [name, { ...skyFiles.stills[name] }]));
for (const setting of argValues('--set')) {
  const match = /^(\w+)\.(\w+)=(.+)$/.exec(setting);
  if (!match || !classes[match[1]] || !(match[2] in classes[match[1]])) {
    console.error(`--set ${setting}: expected <class>.<key>=<value> with a class of ${STILL_CLASSES.join(', ')} and a key of ${Object.keys(classes.phone).join(', ')}.`);
    process.exit(1);
  }
  const value = Number.isFinite(Number(match[3])) ? Number(match[3]) : match[3];
  classes[match[1]][match[2]] = value;
}
for (const [name, spec] of Object.entries(classes)) {
  if (spec.tier !== 'full' && spec.tier !== 'light') {
    console.error(`${name}: the tier must be full or light, not ${spec.tier}.`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------------------------
// The stars the scene draws, placed as it places them
// ---------------------------------------------------------------------------------------------

const catalog = decodeStars(fs.readFileSync(path.join(ROOT, 'public', 'sky', 'stars.bin')));
const drawnCount = {
  full: countBrighterThan(catalog, SKY.scene.star.limit),
  light: countBrighterThan(catalog, SKY.lightTierLimit),
};

/**
 * Every star the scene draws in a still of this class at this moment, as a flat list of
 * [x, y, catalogue magnitude, radius] in device px of the image, x and y at the star's centre.
 */
function starsInStill(spec, timeMs) {
  const frame = { lst: lstDeg(timeMs, SKY.site.lon), width: spec.width, height: spec.height, shiftX: 0, shiftY: 0 };
  const sx = Math.round(spec.width * spec.dpr) / spec.width;
  const sy = Math.round(spec.height * spec.dpr) / spec.height;
  const out = [];
  for (let i = 0; i < drawnCount[spec.tier]; i += 1) {
    const placed = placeStar(catalog.ra[i], catalog.dec[i], catalog.vmag[i], 0, frame);
    if (!placed) continue;
    out.push(placed.x * sx, placed.y * sy, catalog.vmag[i], starRadius(placed.v) * spec.dpr);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// In the page: encode, decode, compare
// ---------------------------------------------------------------------------------------------

/**
 * Runs in the harness page after a still is drawn. Encodes the scene's canvas as WebP at the
 * highest whole-percent quality from `minPercent` to 99 that fits `budget` bytes (a binary search),
 * decodes it again and compares it with the canvas: luma PSNR, alpha, and each star's contrast
 * (its brightest pixel within its radius, less the median of a ring around it). Returns the file
 * as base64 with the numbers.
 */
async function encodeInPage(job) {
  const canvas = document.querySelector('canvas.ar-sky__canvas');
  if (!canvas) throw new Error('the harness has no sky canvas');
  const w = canvas.width;
  const h = canvas.height;
  const pixels = (source) => {
    const c = new OffscreenCanvas(w, h);
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(source, 0, 0);
    return g.getImageData(0, 0, w, h).data;
  };
  const encode = (q) =>
    new Promise((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('canvas.toBlob gave no image'))), 'image/webp', q);
    });

  const frame = pixels(canvas);
  const tried = [];
  let best = null;
  let lo = job.minPercent;
  let hi = 99;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const blob = await encode(mid / 100);
    if (blob.type !== 'image/webp') throw new Error(`this browser encodes ${blob.type}, not image/webp`);
    tried.push([mid, blob.size]);
    if (blob.size <= job.budget) {
      best = { percent: mid, blob };
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  const result = { width: w, height: h, tried };
  if (!best) return result;

  const bitmap = await createImageBitmap(best.blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const decoded = pixels(bitmap);
  bitmap.close();

  const luma = (d) => {
    const y = new Float32Array(w * h);
    for (let i = 0, p = 0; i < y.length; i += 1, p += 4) y[i] = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2];
    return y;
  };
  const y0 = luma(frame);
  const y1 = luma(decoded);

  // Luma PSNR over the opaque pixels, and how far the alpha moved.
  let sum = 0;
  let opaque = 0;
  let alphaMoved = 0;
  let alphaWorst = 0;
  for (let i = 0, p = 3; i < y0.length; i += 1, p += 4) {
    const da = Math.abs(frame[p] - decoded[p]);
    if (da) alphaMoved += 1;
    if (da > alphaWorst) alphaWorst = da;
    if (frame[p] === 255) {
      const d = y0[i] - y1[i];
      sum += d * d;
      opaque += 1;
    }
  }
  result.psnr = opaque ? (sum ? 10 * Math.log10((255 * 255 * opaque) / sum) : Infinity) : null;
  result.alpha = { moved: alphaMoved, worst: alphaWorst, transparent: 0 };
  for (let p = 3; p < frame.length; p += 4) if (frame[p] === 0) result.alpha.transparent += 1;

  // A star's contrast: its brightest pixel within its radius (at least one pixel round its centre)
  // less the median of a square ring two to four pixels further out.
  const contrast = (y, cx, cy, reach) => {
    let peak = -1;
    for (let j = cy - reach; j <= cy + reach; j += 1) {
      if (j < 0 || j >= h) continue;
      for (let i = cx - reach; i <= cx + reach; i += 1) {
        if (i >= 0 && i < w && y[j * w + i] > peak) peak = y[j * w + i];
      }
    }
    const ring = [];
    for (let j = cy - reach - 4; j <= cy + reach + 4; j += 1) {
      if (j < 0 || j >= h) continue;
      for (let i = cx - reach - 4; i <= cx + reach + 4; i += 1) {
        if (i < 0 || i >= w || Math.max(Math.abs(i - cx), Math.abs(j - cy)) < reach + 2) continue;
        ring.push(y[j * w + i]);
      }
    }
    if (peak < 0 || !ring.length) return null;
    ring.sort((a, b) => a - b);
    return peak - ring[ring.length >> 1];
  };
  const tally = () => ({ drawn: 0, counted: 0, lost: 0, dimmed: 0, leastKept: null, worst: [] });
  const stars = { bright: tally(), all: tally() };
  const s = job.stars;
  for (let n = 0; n < s.length; n += 4) {
    const cx = Math.floor(s[n]);
    const cy = Math.floor(s[n + 1]);
    if (cx < 0 || cy < 0 || cx >= w || cy >= h) continue;
    const reach = Math.max(1, Math.ceil(s[n + 3]));
    const c0 = contrast(y0, cx, cy, reach);
    const c1 = contrast(y1, cx, cy, reach);
    if (c0 === null || c1 === null) continue;
    const groups = s[n + 2] < job.bright ? [stars.bright, stars.all] : [stars.all];
    for (const g of groups) {
      g.drawn += 1;
      if (c0 < job.visibleLevels) continue;
      g.counted += 1;
      const kept = Math.max(0, c1) / c0;
      if (kept < job.lostBelow) g.lost += 1;
      if (kept < job.dimmedBelow) g.dimmed += 1;
      if (g.leastKept === null || kept < g.leastKept) g.leastKept = kept;
      g.worst.push([Number(kept.toFixed(3)), s[n + 2], cx, cy, Math.round(c0), Math.round(c1)]);
      g.worst.sort((a, b) => a[0] - b[0]);
      if (g.worst.length > job.worstListed) g.worst.length = job.worstListed;
    }
  }
  result.stars = stars;

  const bytes = new Uint8Array(await best.blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  result.quality = best.percent / 100;
  result.size = best.blob.size;
  result.base64 = btoa(binary);
  return result;
}

// ---------------------------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------------------------

const wanted = (name) => only.length === 0 || only.some((prefix) => name.startsWith(prefix));
const grouping = (n) => n.toLocaleString('en-US');

/** The stills to draw for a class and theme, in order. */
function jobsFor(className, theme) {
  if (theme === 'whiteprint') {
    const file = `whiteprint-${className}.webp`;
    return wanted(file) ? [{ file, time: PREVIEW_MS, step: null }] : [];
  }
  const jobs = [];
  for (let step = 0; step < STILL_STEPS; step += 1) {
    const time = stepTimeNear(step, PREVIEW_MS);
    if (stillStepAt(time) !== step) throw new Error(`stepTimeNear(${step}) lands on step ${stillStepAt(time)}`);
    const file = path.posix.basename(blueprintStillUrl(className, step));
    if (wanted(file)) jobs.push({ file, time, step });
  }
  return jobs;
}

async function launch(chromium) {
  const args = ['--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'];
  if (process.platform === 'win32') args.push('--use-angle=d3d11');
  const options = { headless: !flag('--headed'), args };
  const executable = arg('--executable');
  if (executable) return chromium.launch({ ...options, executablePath: executable });
  if ((arg('--browser') ?? 'chrome') === 'chrome') {
    try {
      return await chromium.launch({ ...options, channel: 'chrome' });
    } catch (error) {
      console.warn(`Chrome did not start (${error.message.split('\n')[0]}); trying Playwright's Chromium.`);
    }
  }
  return chromium.launch(options);
}

async function main() {
  const harness = new URL('/dev-sky', base);
  const probe = await fetch(new URL('?w=8&h=8&still=1', harness)).catch((error) => ({ ok: false, status: error.message }));
  if (!probe.ok) {
    throw new Error(`${harness} answered ${probe.status}. The harness exists only under next dev: start one and pass its URL as --base.`);
  }

  const { chromium } = await import('@playwright/test');
  const browser = await launch(chromium);
  fs.mkdirSync(outDir, { recursive: true });
  const report = { base, outDir, browser: browser.version(), renderer: null, previewMs: PREVIEW_MS, classes, stills: [] };
  const failures = [];

  try {
    for (const className of STILL_CLASSES) {
      const spec = classes[className];
      const context = await browser.newContext({ viewport: { width: spec.width, height: spec.height }, deviceScaleFactor: spec.dpr });
      for (const theme of ['blueprint', 'whiteprint']) {
        const jobs = jobsFor(className, theme);
        if (jobs.length === 0) continue;
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        const query = new URLSearchParams({ theme, tier: spec.tier, w: String(spec.width), h: String(spec.height), time: String(jobs[0].time), still: '1' });
        await page.goto(`${harness}?${query}`, { waitUntil: 'load', timeout: 180_000 });
        await page.waitForFunction(() => window.__skyStill, null, { timeout: 180_000 });
        const state = await page.evaluate(() => window.__skyStill);
        if (state !== 'ready') throw new Error(`${theme} ${className}: the harness says ${state}${errors.length ? ` (${errors.join('; ')})` : ''}`);
        if (!report.renderer) {
          report.renderer = await page.evaluate(() => {
            const gl = document.createElement('canvas').getContext('webgl2');
            const info = gl && gl.getExtension('WEBGL_debug_renderer_info');
            return gl ? String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) : 'no WebGL2';
          });
          console.log(`Chrome ${report.browser}, WebGL: ${report.renderer}`);
        }

        for (const job of jobs) {
          await page.evaluate(async (time) => {
            window.__sky.renderStill(time);
            await new Promise((resolve) => requestAnimationFrame(() => resolve()));
          }, job.time);
          const result = await page.evaluate(encodeInPage, {
            budget: spec.budget,
            minPercent: Math.round(skyFiles.minQuality * 100),
            stars: theme === 'blueprint' ? starsInStill(spec, job.time) : [],
            bright: BRIGHT,
            visibleLevels: VISIBLE_LEVELS,
            lostBelow: LOST_BELOW,
            dimmedBelow: DIMMED_BELOW,
            worstListed: WORST_LISTED,
          });
          const entry = { file: job.file, class: className, theme, step: job.step, time: job.time, ...result };
          delete entry.base64;
          report.stills.push(entry);

          const problems = [];
          const want = [Math.round(spec.width * spec.dpr), Math.round(spec.height * spec.dpr)];
          if (result.width !== want[0] || result.height !== want[1]) problems.push(`drawn ${result.width} x ${result.height} px, not ${want[0]} x ${want[1]}`);
          if (!result.base64) {
            problems.push(`no WebP quality from ${skyFiles.minQuality} fits ${grouping(spec.budget)} bytes (tried ${result.tried.map(([q, b]) => `${q}%: ${b}`).join(', ')})`);
          } else {
            fs.writeFileSync(path.join(outDir, job.file), Buffer.from(result.base64, 'base64'));
            if (theme === 'blueprint' && result.stars.bright.lost > 0) problems.push(`${result.stars.bright.lost} stars brighter than magnitude ${BRIGHT} lost`);
            if (theme === 'whiteprint' && (result.alpha.transparent === 0 || result.alpha.worst > 0)) {
              problems.push(`alpha: ${grouping(result.alpha.transparent)} transparent px in the frame, ${grouping(result.alpha.moved)} px changed by up to ${result.alpha.worst}`);
            }
          }
          const b = result.stars?.bright;
          const a = result.stars?.all;
          const line = result.base64
            ? `${job.file.padEnd(28)} q ${result.quality.toFixed(2)}  ${grouping(result.size).padStart(7)} B  PSNR ${result.psnr.toFixed(1)} dB` +
              (theme === 'blueprint'
                ? `  V<${BRIGHT}: ${b.counted} stars, ${b.lost} lost, ${b.dimmed} dimmed, least kept ${b.leastKept === null ? '-' : b.leastKept.toFixed(2)}` +
                  `  all: ${grouping(a.counted)}, ${a.lost} lost, ${a.dimmed} dimmed`
                : `  alpha: ${grouping(result.alpha.transparent)} px clear, ${result.alpha.moved} moved`)
            : `${job.file.padEnd(28)} not written`;
          console.log(`${problems.length ? 'FAIL' : 'ok  '} ${line}${problems.length ? `\n     ${problems.join('; ')}` : ''}`);
          for (const problem of problems) failures.push(`${job.file}: ${problem}`);
        }
        await page.close();
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }

  // One summary line for each class: sizes, qualities and the star checks.
  console.log('');
  for (const className of STILL_CLASSES) {
    const spec = classes[className];
    const header = `${className}: ${spec.width} x ${spec.height} CSS px at ${spec.dpr}x (${Math.round(spec.width * spec.dpr)} x ${Math.round(spec.height * spec.dpr)} px), ${spec.tier} tier, budget ${grouping(spec.budget)} B`;
    console.log(header);
    for (const theme of ['blueprint', 'whiteprint']) {
      const done = report.stills.filter((s) => s.class === className && s.theme === theme && s.size);
      if (!done.length) continue;
      const sizes = done.map((s) => s.size);
      const qualities = done.map((s) => s.quality);
      let line = `  ${theme}: ${done.length} written, ${grouping(Math.min(...sizes))} to ${grouping(Math.max(...sizes))} B, quality ${Math.min(...qualities).toFixed(2)} to ${Math.max(...qualities).toFixed(2)}`;
      if (theme === 'blueprint') {
        const sum = (key, group) => done.reduce((t, s) => t + s.stars[group][key], 0);
        const least = (group) => Math.min(...done.map((s) => s.stars[group].leastKept ?? 1));
        line += `\n    stars brighter than ${BRIGHT}: ${grouping(sum('counted', 'bright'))} over ${done.length} stills, ${sum('lost', 'bright')} lost, ${sum('dimmed', 'bright')} dimmed, least kept ${least('bright').toFixed(2)}`;
        line += `\n    every star drawn: ${grouping(sum('counted', 'all'))}, ${grouping(sum('lost', 'all'))} lost, ${grouping(sum('dimmed', 'all'))} dimmed`;
      }
      console.log(line);
    }
  }
  if (reportFile) fs.writeFileSync(path.resolve(reportFile), `${JSON.stringify(report, null, 1)}\n`);
  console.log(`\n${report.stills.filter((s) => s.size).length} stills written to ${path.relative(ROOT, outDir) || outDir}.`);
  if (failures.length) {
    console.error(`\n${failures.length} problem${failures.length === 1 ? '' : 's'}:\n${failures.map((f) => `  ${f}`).join('\n')}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
