#!/usr/bin/env node
/**
 * The sky's file check (Phase 5 brief, decision 7; ARCHITECTURE.md 9; docs/V3_PLAN.md D-68 and
 * R-05), for `npm run check:sky` and the end of `prebuild`. It exits 1, with one line for each
 * problem, when a sky data file or a still image is missing, is not the file it should be, or is
 * over its byte budget, or when the credits are missing; it exits 0 otherwise.
 *
 * - Data, in public/sky: stars.bin (within skyFiles.budgets.stars), names.json, milkyway-4k.webp,
 *   milkyway-2k.webp (within skyFiles.budgets.milkyWayLight) and CREDITS.md, the full source notes
 *   the footer's credit line stands for.
 * - Stills, in public/sky/still (scripts/render-stills.mjs writes them): for each width class of
 *   skyFiles.stills, blueprint-<class>-<step>.webp for the 24 steps (the names the head script in
 *   lib/theme.ts asks for) and whiteprint-<class>.webp (the name app/sheet.css section 23 asks
 *   for). Each must be a whole WebP image of the class's size in pixels (width and height times
 *   dpr) within the class's budget.
 *
 * Budgets and sizes come from skyFiles in lib/motion.ts. Budgets are in bytes, and a file of
 * exactly its budget passes.
 *
 * With --build <dist directory> (the `next build` output, such as .next), it checks the built
 * JavaScript instead, after a build (ARCHITECTURE.md 9; R-05, which measures brotli):
 * - no route's first-load JavaScript (app-build-manifest.json) holds three.js or the live scene;
 * - the home page's first load, brotli-compressed, is within skyFiles.budgets.firstLoad;
 * - the sky's deferred JavaScript (the chunks the host's import('./live') loads: the scene and the
 *   three.js chunk it needs), brotli-compressed, is within skyFiles.budgets.liveChunk.
 *
 * Usage: node scripts/check-sky.mjs [--root <repository directory>] [--build [<dist directory>]]
 * (`--build` alone checks NEXT_DIST_DIR, else .next: the package's postbuild runs it so.)
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 18)) {
  console.error(`check:sky needs Node 22.18 or newer to load lib/*.ts directly (this is ${process.versions.node}).`);
  process.exit(1);
}

const SCRIPT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rootArg = process.argv.indexOf('--root');
const ROOT = rootArg > -1 ? path.resolve(process.argv[rootArg + 1]) : SCRIPT_ROOT;
const LIB_URL = pathToFileURL(`${SCRIPT_ROOT}${path.sep}`);

/** Lets Node load lib/*.ts as the bundler does: an import without an extension is the .ts file. */
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (!/^\.{1,2}\//.test(specifier) || /\.[cm]?[jt]sx?$/.test(specifier)) throw error;
      return nextResolve(`${specifier}.ts`, context);
    }
  },
});

const load = (file) => import(new URL(file, LIB_URL).href);
const { skyFiles } = await load('lib/motion.ts');
const { STILL_STEPS } = await load('lib/sky/still-steps.ts');
const { STILL_CLASSES, STILL_DIR, blueprintStillUrl } = await load('lib/theme.ts');
const { STARS_PATH, STAR_NAMES_PATH } = await load('lib/sky/stars.ts');

const publicPath = (url) => path.join(ROOT, 'public', ...url.split('/').filter(Boolean));
const rel = (file) => path.relative(ROOT, file).split(path.sep).join('/');
const grouping = (n) => n.toLocaleString('en-US');
const problems = [];

/** Text that only three.js's own code holds, and text that only the live scene's chunk holds. */
const THREE_MARKERS = [/THREE\.WebGLRenderer/, /__THREE__/, /#include <common>/];
const SCENE_MARKERS = [/ar-sky__canvas/, /uToPanorama/, /milkyway-4k\.webp/];

/** The bytes of a built file, brotli-compressed at the quality a host serves static files with. */
function brotli(file) {
  const bytes = fs.readFileSync(file);
  return zlib.brotliCompressSync(bytes, {
    params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: bytes.length },
  }).length;
}

/** The checks on a finished build (--build). Exits 1 with a line for each problem. */
function checkBuild(dist) {
  const read = (name) => JSON.parse(fs.readFileSync(path.join(dist, name), 'utf8'));
  let pages;
  let runtime;
  try {
    pages = read('app-build-manifest.json').pages;
    const runtimeFile = read('build-manifest.json').rootMainFiles.find((f) => /webpack-/.test(f));
    runtime = fs.readFileSync(path.join(dist, runtimeFile), 'utf8');
  } catch (error) {
    console.error(`check:sky --build: no finished build in ${rel(dist)} (${error.message}).`);
    process.exit(1);
  }
  const text = (file) => fs.readFileSync(path.join(dist, file), 'utf8');
  const holds = (file, markers) => markers.some((re) => re.test(text(file)));

  // Each page's first load: the root layout, the layouts of its segments, and the page itself.
  const firstLoad = new Map();
  for (const entry of Object.keys(pages).filter((key) => key.endsWith('/page'))) {
    const segments = entry.split('/').filter(Boolean).slice(0, -1);
    const chain = ['/layout', ...segments.map((_, i) => `/${segments.slice(0, i + 1).join('/')}/layout`), entry].filter((key) => pages[key]);
    firstLoad.set(entry, [...new Set(chain.flatMap((key) => pages[key]).filter((f) => f.endsWith('.js')))]);
  }
  const everyFirstLoad = new Set([...firstLoad.values()].flat());
  for (const file of everyFirstLoad) {
    if (holds(file, THREE_MARKERS)) problems.push(`${file} is in a first load and holds three.js.`);
    if (holds(file, SCENE_MARKERS)) problems.push(`${file} is in a first load and holds the live scene.`);
  }

  const home = firstLoad.get('/(site)/page') ?? firstLoad.get('/page');
  let homeBytes = 0;
  if (!home) problems.push("the home page's entry is not in app-build-manifest.json.");
  else {
    homeBytes = home.reduce((sum, file) => sum + brotli(path.join(dist, file)), 0);
    if (homeBytes > skyFiles.budgets.firstLoad) {
      problems.push(`the home page's first-load JavaScript is ${grouping(homeBytes)} bytes (brotli), over its budget of ${grouping(skyFiles.budgets.firstLoad)}.`);
    }
  }

  // The host's import('./live'), as webpack writes it in a first-load chunk:
  // Promise.all([r.e(A), r.e(B)]).then(r.bind(r, M)); its chunk ids named through the runtime.
  const chunkFile = (id) => {
    const hash = new RegExp(`(?:^|[,{])${id}:"([0-9a-f]{16})"`).exec(runtime)?.[1];
    const name = new RegExp(`(?:^|[,{])${id}:"([0-9a-f]{8})"`).exec(runtime)?.[1];
    const candidates = hash ? [`static/chunks/${name ?? id}.${hash}.js`, `static/chunks/${id}.${hash}.js`] : [];
    return candidates.find((file) => fs.existsSync(path.join(dist, file))) ?? null;
  };
  const deferred = new Set();
  for (const file of everyFirstLoad) {
    const source = text(file);
    if (!/ar-sky__live/.test(source)) continue;
    for (const match of source.matchAll(/Promise\.all\(\[((?:\w+\.e\(\d+\),?)+)\]\)\.then\(\w+\.bind\(\w+,\d+\)\)/g)) {
      const files = [...match[1].matchAll(/\.e\((\d+)\)/g)].map((m) => chunkFile(m[1]));
      if (files.every(Boolean) && files.some((f) => holds(f, SCENE_MARKERS))) files.forEach((f) => deferred.add(f));
    }
  }
  let liveBytes = 0;
  if (!deferred.size) problems.push("the sky's deferred import (import('./live') in the host's chunk) was not found.");
  else {
    liveBytes = [...deferred].reduce((sum, file) => sum + brotli(path.join(dist, file)), 0);
    if (liveBytes > skyFiles.budgets.liveChunk) {
      problems.push(`the sky's deferred JavaScript (${[...deferred].join(', ')}) is ${grouping(liveBytes)} bytes (brotli), over its budget of ${grouping(skyFiles.budgets.liveChunk)}.`);
    }
  }

  if (problems.length) {
    for (const problem of problems) console.error(`check:sky --build: ${problem}`);
    process.exit(1);
  }
  console.log(
    `check:sky --build: ok. No three.js or live scene in ${everyFirstLoad.size} first-load chunks; ` +
      `home first load ${grouping(homeBytes)} of ${grouping(skyFiles.budgets.firstLoad)} bytes; ` +
      `the sky's deferred JavaScript ${grouping(liveBytes)} of ${grouping(skyFiles.budgets.liveChunk)} bytes (${[...deferred].join(' + ')}), brotli.`,
  );
}

// --build with no directory checks the build `next build` just wrote: NEXT_DIST_DIR when it is set
// (next.config.js reads it too), else .next. This is how `postbuild` runs it.
const buildArg = process.argv.indexOf('--build');
if (buildArg > -1) {
  const named = process.argv[buildArg + 1];
  const dist = named && !named.startsWith('--') ? named : process.env.NEXT_DIST_DIR || '.next';
  checkBuild(path.resolve(ROOT, dist));
  process.exit(0);
}

/**
 * The pixel size of a whole WebP file (RIFF container, 'VP8 ', 'VP8L' or 'VP8X' first chunk), or
 * a description of what is wrong with it.
 */
function webpSize(bytes) {
  if (bytes.length < 30 || bytes.toString('latin1', 0, 4) !== 'RIFF' || bytes.toString('latin1', 8, 12) !== 'WEBP') {
    return { error: 'not a WebP file.' };
  }
  const whole = bytes.readUInt32LE(4) + 8;
  if (whole !== bytes.length) return { error: `not a whole WebP file: its header gives ${grouping(whole)} bytes, the file has ${grouping(bytes.length)}.` };
  const chunk = bytes.toString('latin1', 12, 16);
  if (chunk === 'VP8X') return { width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1 };
  if (chunk === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === 'VP8L' && bytes[20] === 0x2f) {
    const bits = bytes.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  return { error: `a WebP layout this check does not know (${JSON.stringify(chunk)}).` };
}

/** Checks one file: it exists and is not empty, it is within `budget` bytes if one is given, and `inspect` finds nothing wrong. */
function checkFile(file, budget, inspect) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    problems.push(`${rel(file)} is missing.`);
    return null;
  }
  const bytes = fs.readFileSync(file);
  if (bytes.length === 0) {
    problems.push(`${rel(file)} is empty.`);
    return null;
  }
  if (budget !== undefined && bytes.length > budget) {
    problems.push(`${rel(file)} is ${grouping(bytes.length)} bytes, over its budget of ${grouping(budget)}.`);
  }
  const issue = inspect?.(bytes);
  if (issue) problems.push(`${rel(file)}: ${issue}`);
  return bytes.length;
}

const isWebp = (bytes) => webpSize(bytes).error ?? null;

// The data files. The Milky Way's names are the ones the live scene asks for (MILKY_WAY_PATHS in
// components/sky/live/index.ts).
checkFile(publicPath(STARS_PATH), skyFiles.budgets.stars);
checkFile(publicPath(STAR_NAMES_PATH), undefined, (bytes) => {
  try {
    JSON.parse(bytes.toString('utf8'));
    return null;
  } catch {
    return 'not JSON.';
  }
});
checkFile(publicPath('/sky/milkyway-4k.webp'), undefined, isWebp);
checkFile(publicPath('/sky/milkyway-2k.webp'), skyFiles.budgets.milkyWayLight, isWebp);
checkFile(publicPath('/sky/CREDITS.md'));

// The stills, by width class.
const stillDir = publicPath(STILL_DIR);
const expected = new Set();
const summary = [];
for (const widthClass of STILL_CLASSES) {
  const spec = skyFiles.stills[widthClass];
  const want = [Math.round(spec.width * spec.dpr), Math.round(spec.height * spec.dpr)];
  const files = [];
  for (let step = 0; step < STILL_STEPS; step += 1) files.push(publicPath(blueprintStillUrl(widthClass, step)));
  files.push(path.join(stillDir, `whiteprint-${widthClass}.webp`));
  const sizes = [];
  for (const file of files) {
    expected.add(path.basename(file));
    const size = checkFile(file, spec.budget, (bytes) => {
      const got = webpSize(bytes);
      if (got.error) return got.error;
      return got.width === want[0] && got.height === want[1]
        ? null
        : `${got.width} x ${got.height} px, not the ${want[0]} x ${want[1]} px of lib/motion.ts (render the stills again).`;
    });
    if (size !== null) sizes.push(size);
  }
  if (sizes.length) summary.push(`${widthClass} ${grouping(Math.min(...sizes))} to ${grouping(Math.max(...sizes))} of ${grouping(spec.budget)}`);
}
if (fs.existsSync(stillDir)) {
  const extra = fs.readdirSync(stillDir).filter((name) => !expected.has(name));
  if (extra.length) console.warn(`check:sky: not asked for by the site, left in ${rel(stillDir)}: ${extra.join(', ')}`);
}

if (problems.length) {
  for (const problem of problems) console.error(`check:sky: ${problem}`);
  console.error(`check:sky: ${problems.length} problem${problems.length === 1 ? '' : 's'}. Render the stills with npm run render:stills, and the data with npm run build:sky.`);
  process.exit(1);
}
console.log(`check:sky: ok. ${expected.size} stills (bytes: ${summary.join('; ')}) and the 5 sky files.`);
