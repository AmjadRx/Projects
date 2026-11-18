#!/usr/bin/env node
/**
 * Builds the sky's real data (ARCHITECTURE.md 6A) from three published sources:
 *
 *   public/sky/stars.bin          the Yale Bright Star Catalogue, 5th revised edition (CDS VizieR
 *                                 V/50), reduced to its 9,096 stars with positions, in the binary
 *                                 format documented in lib/sky/stars.ts, brightest first
 *   public/sky/names.json         IAU star names (the IAU Catalog of Star Names, kept by the IAU
 *                                 Working Group on Star Names) of the 150 brightest catalogue stars
 *                                 that have one, keyed by their index in stars.bin
 *   public/sky/milkyway-2k.webp   the ESO all-sky Milky Way panorama (eso0932a, ESO/S. Brunier,
 *   public/sky/milkyway-4k.webp   CC BY 4.0) in galactic coordinates as published, 2048 x 1024
 *                                 (under 400 kB) and 4096 x 2048
 *   public/sky/CREDITS.md         each source, the exact files downloaded, the licence or terms as
 *                                 checked, what was changed, and the credit line
 *
 * Each source is downloaded once into its own folder under the cache (--cache, default
 * .cache/sky-sources, which git ignores) and read from there afterwards. Downloads are treated as
 * data, never as code: the catalogue is parsed by the byte layout of its ReadMe, the names page is
 * read as text, and the photograph is decoded only as an image, inside a headless Chrome page whose
 * only content is this script's own (every other request is refused).
 *
 * The still images of the sky are rendered by a later script; this one writes only the data.
 *
 * Usage (Node 22.18 or newer, which loads lib/sky/stars.ts directly):
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/build-sky.mjs
 *     [--cache <dir>] [--out <dir>] [--chrome <path>] [--offline] [--accept-new-sources]
 *
 *   --cache <dir>          where downloads are kept (default .cache/sky-sources)
 *   --out <dir>            where the outputs go (default public/sky)
 *   --chrome <path>        the Chrome to run (else CHROME_PATH, else the installed Google Chrome)
 *   --offline              never download; fail when a source is not in the cache
 *   --accept-new-sources   accept a catalogue or photograph whose SHA-256 differs from the pins
 *                          below (compare the new data first, then update the pins)
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 18)) {
  console.error(`build-sky needs Node 22.18 or newer to load lib/sky/stars.ts directly (this is ${process.versions.node}).`);
  process.exit(1);
}
const { countBrighterThan, decodeStars, encodeStars } = await import('../lib/sky/stars.ts');
// The design's numbers and the budgets, from the one place the site keeps them.
const { SKY, skyFiles } = await import('../lib/motion.ts');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The day each licence and terms page below was read on its official site.
const LICENCES_CHECKED = '2026-11-18';

/** How many named stars names.json keeps (ARCHITECTURE.md 6A; SKY.namedStars in lib/motion.ts). */
const NAMED_STARS = SKY.namedStars;
/**
 * Byte budget of the Light tier's Milky Way texture (ARCHITECTURE.md 9; skyFiles.budgets in
 * lib/motion.ts), and the size this script aims under it when it picks the WebP quality.
 */
const MILKY_WAY_2K_BUDGET = skyFiles.budgets.milkyWayLight;
const MILKY_WAY_2K_TARGET = 380_000;
/** Bytes allowed for stars.bin (ARCHITECTURE.md 9; skyFiles.budgets in lib/motion.ts). */
const STARS_BUDGET = skyFiles.budgets.stars;

/**
 * The sources. Each has its own folder in the cache. URLs are tried in order: the BSC comes from
 * the CDS archive in Strasbourg, else from the CDS VizieR mirror at the Center for Astrophysics.
 */
const SOURCES = {
  bsc: {
    dir: 'bsc5-vizier-V50',
    files: {
      catalog: {
        name: 'catalog.gz',
        urls: ['https://cdsarc.cds.unistra.fr/ftp/V/50/catalog.gz', 'https://vizier.cfa.harvard.edu/ftp/cats/V/50/catalog.gz'],
        maxBytes: 8 << 20,
        check: (bytes) => bytes[0] === 0x1f && bytes[1] === 0x8b,
      },
      readme: {
        name: 'ReadMe',
        urls: ['https://cdsarc.cds.unistra.fr/ftp/V/50/ReadMe', 'https://vizier.cfa.harvard.edu/ftp/cats/V/50/ReadMe'],
        maxBytes: 1 << 20,
        check: (bytes) => bytes.toString('latin1', 0, 4) === 'V/50',
      },
      notes: {
        name: 'notes.gz',
        urls: ['https://cdsarc.cds.unistra.fr/ftp/V/50/notes.gz', 'https://vizier.cfa.harvard.edu/ftp/cats/V/50/notes.gz'],
        maxBytes: 8 << 20,
        check: (bytes) => bytes[0] === 0x1f && bytes[1] === 0x8b,
      },
    },
  },
  names: {
    dir: 'iau-csn',
    files: {
      page: {
        name: 'modern-iau-star-names.html',
        urls: ['https://exopla.net/star-names/modern-iau-star-names/'],
        maxBytes: 32 << 20,
        check: (bytes) => /<table/i.test(bytes.toString('utf8', 0, Math.min(bytes.length, 4 << 20))),
      },
    },
  },
  milkyWay: {
    dir: 'eso0932a',
    files: {
      jpeg: {
        // The largest JPEG the image page offers ("Large JPEG", 6000 x 3000 px). The page's
        // other JPEGs are smaller; its full-size original is a TIFF.
        name: 'eso0932a.jpg',
        urls: ['https://cdn.eso.org/images/large/eso0932a.jpg'],
        maxBytes: 64 << 20,
        check: (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
      },
    },
  },
};

/**
 * SHA-256 of the data this build was made from: the uncompressed V/50 catalogue and remarks
 * (unchanged at CDS since 1993 and 1995) and the ESO JPEG (published in 2009). A download that
 * differs stops the build until someone compares it and passes --accept-new-sources. The names
 * page is a living document and is not pinned; CREDITS.md records the copy used.
 */
const PINS = {
  bscCatalog: '69797549cc1605aad7ff94e9325e29a1661f2a253917faaa056d9bf20b809afd',
  bscNotes: '4614517ebb689fdf6e200d2ce7308b111c92272b8d5f7e492c86ec36777f6a0c',
  esoJpeg: '60400c92c54b7c1bd12299c69e83b16e5b6256e7dabacc478c021758ecd28179',
};

/**
 * T CrB (HR 5958, the "Blaze Star") is a recurrent nova. The catalogue's main table gives its V
 * and B-V at the 1946 outburst maximum (V 2.0), a second-magnitude star the real sky does not
 * show; its remark gives the values near its usual brightness. The sky takes those, read from the
 * remark itself (the pattern below must match, or the build stops).
 */
const FROM_REMARKS = {
  5958: /V and B-V for 1946 maximum\.\s+Near maximum (\d+\.\d+)V, ([+-]\d+\.\d+)\(B-V\)/,
};

// Arguments.
const args = process.argv.slice(2);
const options = { cache: path.join(ROOT, '.cache', 'sky-sources'), out: path.join(ROOT, 'public', 'sky'), chrome: process.env.CHROME_PATH || '', offline: false, acceptNew: false };
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === '--offline') options.offline = true;
  else if (arg === '--accept-new-sources') options.acceptNew = true;
  else if (['--cache', '--out', '--chrome'].includes(arg) && args[i + 1]) {
    options[arg.slice(2)] = path.resolve(args[i + 1]);
    i += 1;
  } else {
    console.error(`Unknown argument: ${arg}\nUsage: node scripts/build-sky.mjs [--cache <dir>] [--out <dir>] [--chrome <path>] [--offline] [--accept-new-sources]`);
    process.exit(2);
  }
}

const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
/** En dash and em dash, built from their code points so that this file holds neither. */
const DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const kB = (n) => `${(n / 1000).toFixed(1)} kB`;
const log = (message) => console.log(message);

// 1. Sources: download each file once into its own cache folder.

/** Downloads one file, trying each URL in turn, refusing anything over maxBytes. */
async function download(file, dest) {
  const errors = [];
  for (const url of file.urls) {
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(300_000),
        headers: { 'user-agent': 'amjadrehawi.com sky data build (scripts/build-sky.mjs)' },
      });
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
      const declared = Number(response.headers.get('content-length') || 0);
      if (declared > file.maxBytes) throw new Error(`${declared} bytes is over the ${file.maxBytes}-byte limit`);
      const chunks = [];
      let total = 0;
      for await (const chunk of response.body) {
        total += chunk.length;
        if (total > file.maxBytes) throw new Error(`more than ${file.maxBytes} bytes`);
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks);
      if (!file.check(bytes)) throw new Error('the file is not what this source should hold');
      fs.writeFileSync(`${dest}.part`, bytes);
      fs.renameSync(`${dest}.part`, dest);
      return {
        url,
        finalUrl: response.url,
        fetchedAt: new Date().toISOString(),
        bytes: bytes.length,
        sha256: sha256(bytes),
        lastModified: response.headers.get('last-modified') || '',
      };
    } catch (error) {
      errors.push(`${url}: ${error.cause?.code || error.message}`);
    }
  }
  throw new Error(`Could not download ${file.name}:\n  ${errors.join('\n  ')}`);
}

/** Makes sure every file of a source is in the cache; returns paths and download records. */
async function ensureSource(source) {
  const dir = path.join(options.cache, source.dir);
  fs.mkdirSync(dir, { recursive: true });
  const recordFile = path.join(dir, 'download.json');
  const records = fs.existsSync(recordFile) ? JSON.parse(fs.readFileSync(recordFile, 'utf8')) : {};
  const out = {};
  for (const [key, file] of Object.entries(source.files)) {
    const dest = path.join(dir, file.name);
    const cached = fs.existsSync(dest) && records[file.name];
    if (cached) {
      const bytes = fs.readFileSync(dest);
      if (bytes.length !== records[file.name].bytes || sha256(bytes) !== records[file.name].sha256 || !file.check(bytes)) {
        throw new Error(`${rel(dest)} no longer matches its download record. Delete ${rel(dir)} and run again.`);
      }
      log(`  cached     ${rel(dest)} (${kB(bytes.length)})`);
    } else {
      if (options.offline) throw new Error(`${rel(dest)} is not in the cache, and --offline was given.`);
      log(`  download   ${file.urls[0]}`);
      records[file.name] = await download(file, dest);
      fs.writeFileSync(recordFile, `${JSON.stringify(records, null, 2)}\n`);
      log(`             from ${records[file.name].url} (${kB(records[file.name].bytes)})`);
    }
    out[key] = { path: dest, record: records[file.name] };
  }
  return out;
}

function checkPin(name, actual) {
  if (PINS[name] === actual) return;
  const message = `${name}: SHA-256 ${actual} differs from the pin ${PINS[name] || '(none)'}.`;
  if (!options.acceptNew) throw new Error(`${message} Compare the new data, then run with --accept-new-sources and update PINS.`);
  log(`  WARNING    ${message} Accepted (--accept-new-sources).`);
}

// 2. The Yale Bright Star Catalogue, by the byte layout of its ReadMe (CDS VizieR V/50).

const BSC_LINES = 9110;
const BSC_STARS = 9096;

/** Parses the V/50 catalogue. Every field is checked against its documented format. */
function parseBsc(text) {
  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  if (lines.length !== BSC_LINES) throw new Error(`The catalogue has ${lines.length} lines, expected ${BSC_LINES}.`);
  const stars = [];
  const removed = [];
  let negativeParallax = 0;
  lines.forEach((raw, i) => {
    if (raw.length > 197 || /[^\x20-\x7e]/.test(raw)) throw new Error(`Catalogue line ${i + 1} is not a 197-byte ASCII record.`);
    const line = raw.padEnd(197, ' ');
    const field = (from, to) => line.slice(from - 1, to);
    if (!/^[ \d]{3}\d$/.test(field(1, 4)) || Number(field(1, 4)) !== i + 1) throw new Error(`Catalogue line ${i + 1} holds HR "${field(1, 4)}".`);
    const hr = i + 1;
    if (!field(76, 90).trim()) {
      removed.push(hr);
      return;
    }
    const pos = /^(\d\d)(\d\d)([ \d]\d\.\d)([+-])(\d\d)(\d\d)(\d\d)$/.exec(field(76, 90));
    if (!pos) throw new Error(`HR ${hr}: unexpected J2000 position "${field(76, 90)}".`);
    const [h, m, s, sign, d, am, as] = [Number(pos[1]), Number(pos[2]), Number(pos[3]), pos[4], Number(pos[5]), Number(pos[6]), Number(pos[7])];
    if (h > 23 || m > 59 || s >= 60 || d > 90 || am > 59 || as > 59) throw new Error(`HR ${hr}: J2000 position out of range.`);
    const ra = 15 * (h + m / 60 + s / 3600);
    const dec = (sign === '-' ? -1 : 1) * (d + am / 60 + as / 3600);
    const vText = field(103, 107).trim();
    if (!/^-?\d\.\d\d?$/.test(vText)) throw new Error(`HR ${hr}: unexpected V magnitude "${vText}".`);
    const bvText = field(110, 114).trim();
    if (bvText && !/^[+-]?\d\.\d\d?$/.test(bvText)) throw new Error(`HR ${hr}: unexpected B-V "${bvText}".`);
    const plxFlag = field(161, 161);
    const plxText = field(162, 166).trim();
    if ((plxFlag !== ' ' && plxFlag !== 'D') || (plxText && !/^[+-]?\.\d\d\d$/.test(plxText))) throw new Error(`HR ${hr}: unexpected parallax "${field(161, 166)}".`);
    const hdText = field(26, 31).trim();
    if (hdText && !/^\d+$/.test(hdText)) throw new Error(`HR ${hr}: unexpected HD number "${hdText}".`);
    const plx = plxText ? Number(plxText) : 0;
    if (plx < 0) negativeParallax += 1;
    stars.push({
      hr,
      hd: hdText ? Number(hdText) : 0,
      ra,
      dec,
      vmag: Number(vText),
      bv: bvText ? Number(bvText) : null,
      spType: field(128, 147).trim(),
      // Negative trigonometric parallaxes (measurement noise around zero) carry no distance.
      parallax: plx > 0 ? Math.round(plx * 1000) : 0,
      parallaxDynamical: plx > 0 && plxFlag === 'D',
    });
  });
  if (stars.length !== BSC_STARS) throw new Error(`The catalogue has ${stars.length} stars with positions, expected ${BSC_STARS}.`);
  return { stars, removed, negativeParallax };
}

/** The remark text of one star, by the ReadMe's layout of "notes": HR in bytes 2 to 5, remark from byte 13. */
function remarkOf(notesText, hr) {
  return notesText
    .split(/\r?\n/)
    .filter((line) => /^ [ \d]{3}\d/.test(line) && Number(line.slice(1, 5)) === hr)
    .map((line) => line.slice(12).trim())
    .join(' ');
}

/** Applies FROM_REMARKS: V and B-V read from each star's own remark. */
function applyRemarks(stars, notesText) {
  return Object.entries(FROM_REMARKS).map(([key, pattern]) => {
    const hr = Number(key);
    const star = stars.find((s) => s.hr === hr);
    const match = pattern.exec(remarkOf(notesText, hr));
    if (!star || !match) throw new Error(`The catalogue's remark for HR ${hr} no longer reads as expected.`);
    const change = { hr, vmag: [star.vmag, Number(match[1])], bv: [star.bv, Number(match[2])] };
    star.vmag = change.vmag[1];
    star.bv = change.bv[1];
    return change;
  });
}

/** The spectral class and subclass of an MK type, for example K5 from "K5III" or G6 from "sgG6". */
function spectralKeys(spType) {
  const match = /([OBAFGKMSCNRW])(\d)?/.exec(spType);
  if (!match) return [];
  return match[2] ? [`${match[1]}${match[2]}`, match[1]] : [match[1]];
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * Fills a missing B-V with the median B-V of the catalogue stars that share the star's spectral
 * class and subclass (K5), else its class (K), else of the whole catalogue, rounded to 0.01 mag.
 * The estimate is flagged in stars.bin.
 */
function estimateMissingColors(stars) {
  const groups = new Map();
  const all = [];
  for (const star of stars) {
    if (star.bv === null) continue;
    all.push(star.bv);
    for (const key of spectralKeys(star.spType)) {
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(star.bv);
    }
  }
  const fallback = median(all);
  const used = { subclass: 0, class: 0, catalogue: 0 };
  for (const star of stars) {
    star.bvEstimated = star.bv === null;
    if (!star.bvEstimated) continue;
    const keys = spectralKeys(star.spType);
    const key = keys.find((k) => (groups.get(k) || []).length >= 3);
    star.bv = Math.round((key ? median(groups.get(key)) : fallback) * 100) / 100;
    used[!key ? 'catalogue' : key.length > 1 ? 'subclass' : 'class'] += 1;
  }
  return { count: used.subclass + used.class + used.catalogue, ...used, fallback };
}

// 3. IAU star names: the IAU Catalog of Star Names (IAU-CSN) page of the WGSN, read as text.

function decodeEntities(text) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return text
    .replace(/&#(\d+);/g, (all, n) => (Number(n) < 0x110000 ? String.fromCodePoint(Number(n)) : all))
    .replace(/&#x([0-9a-f]+);/gi, (all, n) => (parseInt(n, 16) < 0x110000 ? String.fromCodePoint(parseInt(n, 16)) : all))
    .replace(/&([a-z]+);/gi, (all, n) => named[n.toLowerCase()] ?? all);
}

const cellText = (html) => decodeEntities(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

/** A name may hold letters, combining marks, spaces, apostrophes, periods and hyphens only. */
const NAME_SHAPE = /^\p{L}[\p{L}\p{M}'’ .-]{0,38}$/u;

/** Reads the rows of the catalogue table on the WGSN page. */
function parseCsn(html) {
  const tables = [...html.replace(/<script[\s\S]*?<\/script>/gi, '').matchAll(/<table[\s\S]*?<\/table>/gi)].map((m) => m[0]);
  const rowsOf = (table) => [...table.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((r) => [...r[0].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) => cellText(c[1])));
  const table = tables.map(rowsOf).find((rows) => rows.length > 0 && rows[0][0]?.toLowerCase() === 'proper names');
  if (!table) throw new Error('The names page has no table whose first column is "proper names"; its layout has changed.');
  const header = table[0].map((h) => h.toLowerCase());
  const col = {};
  for (const [key, label] of Object.entries({ name: 'proper names', designation: 'designation', bayer: 'bayer id', ra: 'ra', dec: 'dec', mag: 'mag', adopted: 'date of adoption' })) {
    col[key] = header.indexOf(label);
    if (col[key] < 0) throw new Error(`The names table has no "${label}" column; its layout has changed.`);
  }
  const rows = [];
  const rejected = [];
  for (const cells of table.slice(1)) {
    if (cells[0]?.toLowerCase() === 'proper names') continue; // the header repeated as a footer
    const row = {
      name: cells[col.name] || '',
      designation: cells[col.designation] || '',
      bayer: cells[col.bayer] || '',
      ra: Number.parseFloat(cells[col.ra]),
      dec: Number.parseFloat(cells[col.dec]),
      mag: Number.parseFloat(cells[col.mag]),
      adopted: cells[col.adopted] || '',
    };
    if (!NAME_SHAPE.test(row.name)) rejected.push(`"${row.name}" (${row.designation}): not a plain name`);
    else rows.push(row);
  }
  return { rows, rejected };
}

const RAD = Math.PI / 180;
/** Angular separation in arcseconds. */
function separation(ra1, dec1, ra2, dec2) {
  const a = Math.sin(((dec2 - dec1) * RAD) / 2) ** 2 + Math.cos(dec1 * RAD) * Math.cos(dec2 * RAD) * Math.sin(((ra2 - ra1) * RAD) / 2) ** 2;
  return (2 * Math.asin(Math.min(1, Math.sqrt(a)))) / RAD * 3600;
}

/**
 * The page's right ascension with one known slip undone. On the page as read on 2026-11-18, some
 * rows give right ascension as 15 h + m / 60 degrees, minutes of time read as arcminutes (Mizar's
 * 13 h 23.9 min is written 195.40 instead of 200.98). NaN when the value cannot carry that slip.
 */
function undoMinutesSlip(ra) {
  const hours = Math.floor(ra / 15);
  const rest = ra - 15 * hours;
  return Number.isFinite(ra) && rest < 1 ? 15 * hours + 15 * rest : Number.NaN;
}

/**
 * Joins names to catalogue stars. A designation "HR n" joins by HR number and "HD n" by HD number,
 * the WGSN's own identifiers, confirmed by position: the star must lie within 2 arcmin of the
 * row's coordinates, as written or with the minutes slip undone. Other designations (the WGSN
 * writes some multiple stars as "* alf Cru") join by position: the brightest catalogue star within
 * 1 arcmin (again as written or with the slip undone) whose V is within 1.5 mag of the row's
 * magnitude, which is the primary the name belongs to. A star keeps one name.
 */
function joinNames(rows, stars) {
  const byHr = new Map(stars.map((s) => [s.hr, s]));
  const byHd = new Map(stars.filter((s) => s.hd).map((s) => [s.hd, s]));
  const named = new Map();
  const report = { hr: 0, hd: 0, position: [], rejected: [], unmatched: [], outside: 0, slipUndone: [] };
  const within = (ra, dec, star, arcsec) => Number.isFinite(ra) && Number.isFinite(dec) && Math.abs(star.dec - dec) < 0.05 && separation(ra, dec, star.ra, star.dec) <= arcsec;
  const take = (star, row, how) => {
    if (named.has(star.hr)) {
      report.rejected.push(`${row.name} (${row.designation}): HR ${star.hr} is already ${named.get(star.hr).name}`);
      return;
    }
    named.set(star.hr, { name: row.name, how, designation: row.designation });
    if (how === 'position') report.position.push(`${row.name} (${row.designation}, ${row.bayer}) -> HR ${star.hr}`);
    else report[how] += 1;
  };
  const keyed = [];
  const loose = [];
  for (const row of rows) {
    const hr = /^HR\s*(\d{1,4})$/.exec(row.designation);
    const hd = /^HD\s*(\d{1,6})$/.exec(row.designation);
    if (hr || hd) keyed.push({ row, star: hr ? byHr.get(Number(hr[1])) : byHd.get(Number(hd[1])), how: hr ? 'hr' : 'hd' });
    else loose.push(row);
  }
  for (const { row, star, how } of keyed) {
    if (!star) {
      report.outside += 1;
      continue;
    }
    if (within(row.ra, row.dec, star, 120)) take(star, row, how);
    else if (within(undoMinutesSlip(row.ra), row.dec, star, 120)) {
      report.slipUndone.push(`${row.name} (${row.designation})`);
      take(star, row, how);
    } else report.rejected.push(`${row.name} (${row.designation}): HR ${star.hr} is not at the row's position`);
  }
  for (const row of loose) {
    const fits = (ra) => stars.filter((s) => within(ra, row.dec, s, 60) && !(Math.abs(s.vmag - row.mag) > 1.5));
    let near = fits(row.ra);
    if (!near.length && (near = fits(undoMinutesSlip(row.ra))).length) report.slipUndone.push(`${row.name} (${row.designation})`);
    if (!near.length) {
      report.unmatched.push(row);
      continue;
    }
    take(near.reduce((a, b) => (b.vmag < a.vmag ? b : a)), row, 'position');
  }
  return { named, report };
}

// 4. The Milky Way: JPEG header, then resampling and encoding in Chrome.

/** Width, height and color profile from a JPEG's markers, read as bytes. */
function jpegInfo(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('The Milky Way file is not a JPEG.');
  let i = 2;
  let icc = false;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) throw new Error('The Milky Way JPEG has a broken marker.');
    const marker = bytes[i + 1];
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    const length = bytes.readUInt16BE(i + 2);
    if (marker === 0xe2 && bytes.toString('latin1', i + 4, i + 15) === 'ICC_PROFILE') icc = true;
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: bytes.readUInt16BE(i + 5), width: bytes.readUInt16BE(i + 7), components: bytes[i + 9], icc };
    }
    i += 2 + length;
  }
  throw new Error('The Milky Way JPEG has no frame header.');
}

/** Width and height from a WebP file's first chunk. */
function webpInfo(bytes) {
  if (bytes.toString('latin1', 0, 4) !== 'RIFF' || bytes.toString('latin1', 8, 12) !== 'WEBP') throw new Error('Not a WebP file.');
  const chunk = bytes.toString('latin1', 12, 16);
  if (chunk === 'VP8X') return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
  if (chunk === 'VP8 ') return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  if (chunk === 'VP8L') {
    const bits = bytes.readUInt32LE(21);
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) };
  }
  throw new Error(`Unknown WebP chunk ${chunk}.`);
}

/**
 * Runs inside the Chrome page (its source is sent as text, so it may use no outside names).
 * Decodes the JPEG as an image, reduces it to 4096 x 2048 by area averaging in linear light (each
 * output pixel is the exact mean of the source area it covers), takes 2048 x 1024 as the mean of
 * each 2 x 2 block, measures the galactic layout, and encodes both as WebP.
 */
async function milkyWayInPage({ width, height, budget, target }) {
  const response = await fetch('/source.jpg');
  const bitmap = await createImageBitmap(await response.blob(), { colorSpaceConversion: 'default', premultiplyAlpha: 'none' });
  if (bitmap.width !== width || bitmap.height !== height) throw new Error(`Chrome decoded ${bitmap.width} x ${bitmap.height}, the header says ${width} x ${height}.`);
  const source = new OffscreenCanvas(width, height);
  const sctx = source.getContext('2d', { willReadFrequently: true });
  sctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  const toLinear = new Float32Array(256);
  for (let i = 0; i < 256; i += 1) {
    const c = i / 255;
    toLinear[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }

  const W = 4096;
  const H = 2048;
  // Horizontal spans: the source pixels under each output column, weighted by covered share.
  const fx = W / width;
  const spanStart = new Int32Array(W + 1);
  const spanSource = [];
  const spanWeight = [];
  for (let x = 0; x < W; x += 1) {
    spanStart[x] = spanSource.length;
    const a = x / fx;
    const b = (x + 1) / fx;
    for (let s = Math.floor(a); s < Math.min(width, Math.ceil(b)); s += 1) {
      const overlap = Math.min(b, s + 1) - Math.max(a, s);
      if (overlap > 0) {
        spanSource.push(s * 4);
        spanWeight.push(overlap * fx);
      }
    }
  }
  spanStart[W] = spanSource.length;
  const spanAt = Int32Array.from(spanSource);
  const spanW = Float32Array.from(spanWeight);

  const fy = H / height;
  const big = new Float32Array(W * H * 3);
  const row = new Float32Array(W * 3);
  const STRIP = 128;
  for (let y0 = 0; y0 < height; y0 += STRIP) {
    const n = Math.min(STRIP, height - y0);
    const px = sctx.getImageData(0, y0, width, n).data;
    for (let r = 0; r < n; r += 1) {
      const base = r * width * 4;
      for (let x = 0; x < W; x += 1) {
        let R = 0;
        let G = 0;
        let B = 0;
        for (let k = spanStart[x]; k < spanStart[x + 1]; k += 1) {
          const i = base + spanAt[k];
          const w = spanW[k];
          R += toLinear[px[i]] * w;
          G += toLinear[px[i + 1]] * w;
          B += toLinear[px[i + 2]] * w;
        }
        row[x * 3] = R;
        row[x * 3 + 1] = G;
        row[x * 3 + 2] = B;
      }
      // The output rows this source row covers, weighted by the share of each it fills.
      const a = (y0 + r) * fy;
      const b = (y0 + r + 1) * fy;
      for (let y = Math.floor(a); y < Math.min(H, Math.ceil(b)); y += 1) {
        const share = Math.min(b, y + 1) - Math.max(a, y);
        if (share <= 0) continue;
        const o = y * W * 3;
        for (let k = 0; k < W * 3; k += 1) big[o + k] += row[k] * share;
      }
    }
  }

  const W2 = W / 2;
  const H2 = H / 2;
  const small = new Float32Array(W2 * H2 * 3);
  for (let y = 0; y < H2; y += 1) {
    for (let x = 0; x < W2; x += 1) {
      for (let c = 0; c < 3; c += 1) {
        const i = (2 * y * W + 2 * x) * 3 + c;
        small[(y * W2 + x) * 3 + c] = (big[i] + big[i + 3] + big[i + W * 3] + big[i + W * 3 + 3]) / 4;
      }
    }
  }

  // The layout: u = 0.5 - l / 360 and v = 0.5 - b / 180 (the renderer's mapping).
  const lum = (x, y) => {
    const i = (y * W2 + x) * 3;
    return 0.2126 * small[i] + 0.7152 * small[i + 1] + 0.0722 * small[i + 2];
  };
  const wrap = (deg) => ((((deg + 180) % 360) + 360) % 360) - 180;
  // The brightest stretch of the band within 10 degrees of the plane, smoothed over 20 degrees.
  const plane = new Float64Array(W2);
  for (let y = Math.round((0.5 - 10 / 180) * H2); y < Math.round((0.5 + 10 / 180) * H2); y += 1) {
    for (let x = 0; x < W2; x += 1) plane[x] += lum(x, y);
  }
  const half = Math.round((10 / 360) * W2);
  let peakX = 0;
  let peak = -1;
  for (let x = 0; x < W2; x += 1) {
    let sum = 0;
    for (let k = -half; k <= half; k += 1) sum += plane[(x + k + W2) % W2];
    if (sum > peak) {
      peak = sum;
      peakX = x;
    }
  }
  // The brightest latitude, from row means smoothed over 6 degrees.
  const rows = new Float64Array(H2);
  for (let y = 0; y < H2; y += 1) for (let x = 0; x < W2; x += 1) rows[y] += lum(x, y) / W2;
  const rhalf = Math.round((3 / 180) * H2);
  let peakY = 0;
  let rowPeak = -1;
  for (let y = rhalf; y < H2 - rhalf; y += 1) {
    let sum = 0;
    for (let k = -rhalf; k <= rhalf; k += 1) sum += rows[y + k];
    if (sum > rowPeak) {
      rowPeak = sum;
      peakY = y;
    }
  }
  // Mean brightness within r1 degrees of (l, b) over the mean in the ring from r2 to r3 degrees.
  const contrast = (l0, b0, r1, r2, r3) => {
    const xc = (((0.5 - l0 / 360) % 1) + 1) % 1 * W2;
    const yc = (0.5 - b0 / 180) * H2;
    const dx = Math.ceil((r3 / 360) * W2 / Math.max(0.15, Math.cos(b0 * (Math.PI / 180)))) + 2;
    const dy = Math.ceil((r3 / 180) * H2) + 2;
    let inner = 0;
    let innerN = 0;
    let ring = 0;
    let ringN = 0;
    for (let y = Math.max(0, Math.floor(yc - dy)); y <= Math.min(H2 - 1, Math.ceil(yc + dy)); y += 1) {
      const b = (0.5 - (y + 0.5) / H2) * 180;
      for (let k = -dx; k <= dx; k += 1) {
        const x = (((Math.floor(xc) + k) % W2) + W2) % W2;
        const l = (0.5 - (x + 0.5) / W2) * 360;
        const cosd = Math.sin(b * (Math.PI / 180)) * Math.sin(b0 * (Math.PI / 180)) + Math.cos(b * (Math.PI / 180)) * Math.cos(b0 * (Math.PI / 180)) * Math.cos((l - l0) * (Math.PI / 180));
        const d = Math.acos(Math.max(-1, Math.min(1, cosd))) * (180 / Math.PI);
        const v = lum(x, y);
        if (d <= r1) {
          inner += v;
          innerN += 1;
        } else if (d >= r2 && d <= r3) {
          ring += v;
          ringN += 1;
        }
      }
    }
    return inner / innerN / (ring / ringN);
  };
  // The Large and Small Magellanic Clouds, and where they would be if the image were mirrored.
  const LMC = [280.47, -32.89];
  const SMC = [302.8, -44.3];
  const clouds = {};
  for (const [name, [l, b]] of Object.entries({ LMC, SMC })) {
    clouds[name] = {
      atPlace: contrast(l, b, 2, 7, 11),
      mirroredInLongitude: contrast(360 - l, b, 2, 7, 11),
      mirroredInLatitude: contrast(l, -b, 2, 7, 11),
    };
  }

  const encode8 = (lin, w, h) => {
    const image = new ImageData(w, h);
    const d = image.data;
    for (let i = 0, j = 0; i < w * h * 3; i += 3, j += 4) {
      for (let c = 0; c < 3; c += 1) {
        const v = Math.min(1, Math.max(0, lin[i + c]));
        d[j + c] = Math.round((v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055) * 255);
      }
      d[j + 3] = 255;
    }
    return image;
  };
  const webp = async (image, quality) => {
    const canvas = new OffscreenCanvas(image.width, image.height);
    canvas.getContext('2d', { alpha: false }).putImageData(image, 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/webp', quality: quality / 100 });
    if (blob.type !== 'image/webp') throw new Error('This Chrome cannot encode WebP.');
    return blob;
  };
  const base64 = async (blob) => {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };

  // The highest quality (whole percent, 50 to 95) whose 2K file is within the target.
  const image2k = encode8(small, W2, H2);
  let lo = 50;
  let hi = 95;
  let best = null;
  const tried = [];
  while (lo <= hi) {
    const q = (lo + hi) >> 1;
    const blob = await webp(image2k, q);
    tried.push([q, blob.size]);
    if (blob.size <= target) {
      best = { q, blob };
      lo = q + 1;
    } else hi = q - 1;
  }
  if (!best || best.blob.size >= budget) throw new Error(`No WebP quality from 50 keeps the 2K Milky Way within ${target} bytes (tried ${JSON.stringify(tried)}).`);
  const blob4k = await webp(encode8(big, W, H), best.q);

  return {
    quality: best.q,
    tried,
    webp2k: await base64(best.blob),
    webp4k: await base64(blob4k),
    centreLongitude: wrap((0.5 - (peakX + 0.5) / W2) * 360),
    planeLatitude: (0.5 - (peakY + 0.5) / H2) * 180,
    clouds,
  };
}

async function buildMilkyWay(jpegPath) {
  const bytes = fs.readFileSync(jpegPath);
  const info = jpegInfo(bytes);
  if (info.width < 4096 || info.width !== info.height * 2) throw new Error(`The Milky Way JPEG is ${info.width} x ${info.height}; expected 2:1 and at least 4096 px wide.`);
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch(options.chrome ? { executablePath: options.chrome } : { channel: 'chrome' });
  const origin = 'https://sky-build.invalid';
  try {
    const context = await browser.newContext();
    // The page is this script's own; the JPEG is served to it as image bytes; nothing else loads.
    await context.route('**/*', (route) => {
      const url = new URL(route.request().url());
      if (url.origin === origin && url.pathname === '/') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset="utf-8"><title>sky build</title>' });
      if (url.origin === origin && url.pathname === '/source.jpg') return route.fulfill({ contentType: 'image/jpeg', body: bytes });
      return route.abort();
    });
    const page = await context.newPage();
    await page.goto(`${origin}/`);
    const result = await page.evaluate(milkyWayInPage, { width: info.width, height: info.height, budget: MILKY_WAY_2K_BUDGET, target: MILKY_WAY_2K_TARGET });
    return { ...result, source: info, chrome: browser.version() };
  } finally {
    await browser.close();
  }
}

/** Fails the build unless the image's layout is the galactic one the renderer assumes. */
function checkGalacticLayout(result) {
  const problems = [];
  if (Math.abs(result.centreLongitude) > 15) problems.push(`the band is brightest at galactic longitude ${result.centreLongitude.toFixed(1)}, not near 0 (u 0.5)`);
  if (Math.abs(result.planeLatitude) > 5) problems.push(`the band lies at galactic latitude ${result.planeLatitude.toFixed(1)}, not near 0 (v 0.5)`);
  for (const [name, c] of Object.entries(result.clouds)) {
    if (!(c.atPlace > 1.25 && c.atPlace > c.mirroredInLongitude + 0.15 && c.atPlace > c.mirroredInLatitude + 0.15)) {
      problems.push(`the ${name} is not where l and b put it (contrast ${c.atPlace.toFixed(2)}, mirrored ${c.mirroredInLongitude.toFixed(2)} and ${c.mirroredInLatitude.toFixed(2)})`);
    }
  }
  if (problems.length) throw new Error(`The Milky Way image does not have the expected galactic layout: ${problems.join('; ')}.`);
}

// 5. CREDITS.md.

function credits({ bsc, names, milkyWay, starsInfo, namesInfo, mw }) {
  const iso = (s) => s.slice(0, 10);
  const b = bsc.catalog.record;
  const r = bsc.readme.record;
  const t = bsc.notes.record;
  const tcrb = starsInfo.remarks.find((x) => x.hr === 5958);
  const signed = (v, digits) => `${v > 0 ? '+' : ''}${v.toFixed(digits)}`;
  const colorRule = [
    starsInfo.bvBySubclass && `of the same spectral class and subclass, for example K5 (${starsInfo.bvBySubclass} stars)`,
    starsInfo.bvByClass && `of the same class (${starsInfo.bvByClass} stars)`,
    starsInfo.bvByCatalogue && `of all of them (${starsInfo.bvByCatalogue} stars)`,
  ]
    .filter(Boolean)
    .join(', else ');
  const n = names.page.record;
  const e = milkyWay.jpeg.record;
  const mirror = (url) => (url.includes('cfa.harvard.edu') ? ' (the CDS VizieR mirror at the Center for Astrophysics, Harvard and Smithsonian)' : '');
  const from = (rec) => (rec.finalUrl && rec.finalUrl !== rec.url ? `${rec.url} (served from ${rec.finalUrl})` : rec.url);
  return `# Sky data: sources and credits

The sky behind every public page is drawn from real data: a star catalogue, the official star names,
and an all-sky photograph of the Milky Way. This file lists each source, the exact file downloaded,
its licence or terms as read on ${LICENCES_CHECKED} on its official page (or, where that page could not
be read that day, in the archived copy named with it), what was changed, and the credit the footer
prints. It is written by \`scripts/build-sky.mjs\`.

## Stars: the Yale Bright Star Catalogue

- Title: The Bright Star Catalogue, 5th Revised Ed. (Preliminary Version), CDS VizieR catalogue V/50.
- Authors: Dorrit Hoffleit (Yale University) and Wayne H. Warren Jr. (NASA Goddard Space Flight
  Center, National Space Science Data Center).
- Edition: 5th revised edition, Astronomical Data Center, NSSDC/ADC, 1991 (bibcode
  1991bsc..book.....H); distributed by CDS, Strasbourg, through VizieR.
- Downloaded on ${iso(b.fetchedAt)}:
  - ${from(b)}${mirror(b.url)}, ${b.bytes} bytes, SHA-256 ${b.sha256}
    (uncompressed catalogue: SHA-256 ${starsInfo.catalogSha256})
  - ${from(t)}${mirror(t.url)}, ${t.bytes} bytes, SHA-256 ${t.sha256}
    (uncompressed remarks: SHA-256 ${starsInfo.notesSha256})
  - ${from(r)}${mirror(r.url)}, ${r.bytes} bytes, SHA-256 ${r.sha256}
- Terms: CDS, General Terms and Conditions of the CDS web sites, mirror sites included
  (https://cds.unistra.fr/legals/, last updated January 7, 2026, read ${LICENCES_CHECKED}):
  > "All Users must comply with the User licence specific to each Dataset."
  >
  > "The Data Sets must be cited in any work or product that uses them by including - if available -
  > the DOI (Digital Object Identifier), as well as the source by mentioning the CDS service that
  > supplied them [...] and at least: "CDS/SIMBAD", "CDS/VizieR", "CDS/Aladin"."
  >
  > "Datasets containing only Public Information are distributed under an Open Licence or ODbL (see:
  > https://www.data.gouv.fr/licences) or CC-BY."
  >
  > "Datasets subject to a specific licence from the data Contributor are distributed in accordance
  > with the licence rights. This specific licence is provided on the Dataset page."
- Licence of V/50 itself: none is stated. Its ReadMe holds no copyright or licence statement, and the
  catalogue's page at CDS (https://cdsarc.cds.unistra.fr/viz-bin/cat/V/50) lists no licence in the
  copy archived on 2026-10-19. On 2026-11-18 neither that page nor the VizieR rules of usage
  (https://cds.unistra.fr/vizier-org/licences_vizier.html, which CDS names as the rights statement of
  its catalogues) could be read: the archive host did not answer, and the rules page answered "This
  page is currently unavailable". The rules' archived copy of 2026-10-25 reads: "The data retrieved
  with VizieR are free of usage in a scientific context", "The commercial usage of the data is
  subject to rules depending of the origin", and, for data from other producers, "Please refer to
  the ReadMe file associated to the catalogue to verify if a "copyright" exists."
- Citation: Hoffleit D., Warren Jr W.H., 1991, The Bright Star Catalogue, 5th Revised Ed., VizieR
  Online Data Catalog V/50, CDS/VizieR.
- Changed: reduced to the ${starsInfo.count.toLocaleString('en-US')} entries that are stars with positions (the ${starsInfo.removed} others are
  novae, star clusters and one galaxy, kept in the catalogue only for their numbers), and to six
  fields per star: right ascension and declination (J2000), V magnitude, B-V, parallax and HR
  number. Positions are quantized to 0.31 arcsec steps
  (the catalogue gives about 1 arcsec); V, B-V and parallax keep the catalogue's own steps. The
  ${starsInfo.bvEstimated} stars without B-V get the median B-V of the catalogue stars ${colorRule}; these
  estimates are flagged. The ${starsInfo.negativeParallax} negative trigonometric parallaxes are stored as unknown (0). One
  star takes its values from the catalogue's remarks instead of its main table: T CrB (HR 5958,
  the "Blaze Star"), a recurrent nova that the main table lists at its 1946 outburst maximum
  (V ${tcrb.vmag[0].toFixed(1)}, B-V ${signed(tcrb.bv[0], 1)}), gets the values its remark gives near its usual brightness
  (V ${tcrb.vmag[1].toFixed(2)}, B-V ${signed(tcrb.bv[1], 2)}), so it does not shine as a second-magnitude star the sky does not show.
  Sorted brightest first and written in the binary format of \`lib/sky/stars.ts\` (\`stars.bin\`,
  ${starsInfo.bytes.toLocaleString('en-US')} bytes).
- Footer credit: "Stars: Yale Bright Star Catalogue (Hoffleit and Warren)."

## Star names: the IAU Catalog of Star Names

- Title: IAU Catalog of Star Names (IAU-CSN), the list of star names adopted by the International
  Astronomical Union.
- Authors: the IAU Division C Working Group on Star Names (WGSN).
- Edition: the living catalogue as published on ${iso(n.fetchedAt)}; its newest adoption in the copy used is
  dated ${namesInfo.newestAdoption}. The IAU's announcement of new star names of 12 February 2026
  (https://iau.org/IAU/News/Ann2026/New-Star-Names-2026.aspx) links this page as the "IAU Star Names
  Catalog".
- Downloaded on ${iso(n.fetchedAt)}: ${n.url}, ${n.bytes} bytes, SHA-256 ${n.sha256} (the page as served
  that day; the page changes as names are added).
- Terms, from the same page, section "CSN Usage (Credits)", read ${LICENCES_CHECKED}:
  > "IAU-star names are free to use and not subject to copyright or intellectual property licensing;
  > they are scientific standards (like the unit of measure “meter” or “light-year”), belong to the public
  > domain and are not owned by anybody (neither the IAU nor WGSN). As long as you simply use them to
  > label a star map or write a research paper in English, these are the official names"
  The same section asks for a Creative Commons licence only for the WGSN's texts and images on the
  names' history; none of those are used here.
- Changed: only the names are used, joined to the catalogue by HR or HD number (confirmed by the
  position the page gives) or, for the ${namesInfo.byPosition} stars the page designates otherwise (as "* alf Cru"),
  by position, to the brightest catalogue star within 1 arcmin. In ${namesInfo.slipUndone} rows the page writes right
  ascension with minutes of time read as arcminutes; the join allows for that. ${namesInfo.joined} names match a
  catalogue star; the names of the ${namesInfo.kept} brightest of those stars are kept, spelled as published (column
  "proper names"), in \`names.json\`, keyed by the star's index in \`stars.bin\`. A star without an
  IAU name has no entry and no label.
- Footer credit: none is required; the names are credited here.

## Milky Way: the ESO all-sky panorama

- Title: The Milky Way panorama (eso0932a), the first image of ESO's GigaGalaxy Zoom project,
  released 14 September 2009.
- Author: Serge Brunier, for ESO. Credit line, as the image page gives it: "ESO/S. Brunier".
- Edition: the 18-million-pixel release on ESO's site, ${mw.source.width} x ${mw.source.height} px, in galactic coordinates
  (plate carree, the galactic centre in the middle, longitude increasing to the left), as the image
  page offers it as "Large JPEG", the largest of its JPEG files. Image page:
  https://www.eso.org/public/images/eso0932a/
- Downloaded on ${iso(e.fetchedAt)}: ${e.url}, ${e.bytes} bytes, SHA-256 ${e.sha256}
- Licence: Creative Commons Attribution 4.0 International (CC BY 4.0),
  https://creativecommons.org/licenses/by/4.0/
  - ESO, Usage of images, videos, music and web texts (https://www.eso.org/public/outreach/copyright/,
    read ${LICENCES_CHECKED}):
    > "Unless specifically noted, the images, videos, and music distributed on the public ESO
    > website, along with the texts of press releases, announcements, pictures of the week, blog
    > posts and captions, are licensed under a Creative Commons Attribution 4.0 International
    > License, and may on a non-exclusive basis be reproduced without fee provided the credit is
    > clear and visible."
    >
    > "The license allows to modify ESO material, provided that you indicate what those
    > modifications are. In particular, you must clearly indicate if you have used AI to modify our
    > content."
  - The image page (read ${LICENCES_CHECKED}): "Crediting this image with the full credit line, in a
    visible way is MANDATORY, if you want to use it without paying a fee."
  - CC BY 4.0, legal code, section 3(a)(1) (https://creativecommons.org/licenses/by/4.0/legalcode.en,
    read ${LICENCES_CHECKED}): "indicate if You modified the Licensed Material and retain an indication of
    any previous modifications; and indicate the Licensed Material is licensed under this Public
    License, and include the text of, or the URI or hyperlink to, this Public License."
- Changed: resized from ${mw.source.width} x ${mw.source.height} px to 4096 x 2048 px (\`milkyway-4k.webp\`, ${mw.size4k.toLocaleString('en-US')} bytes) and
  2048 x 1024 px (\`milkyway-2k.webp\`, ${mw.size2k.toLocaleString('en-US')} bytes) by area averaging in linear light, and
  re-encoded as WebP at quality ${mw.quality} in Chrome ${mw.chrome}. Nothing else: no crop, no change of
  color or tone, and no AI. On the site the sky renderer shows the picture dimmed and projected onto
  the sky over Santa Clara, behind the catalogue stars.
- Footer credit: "Milky Way: ESO/S. Brunier, CC BY." with "CC BY" linked to
  https://creativecommons.org/licenses/by/4.0/ (rel="license").
`;
}

// Main.

async function main() {
  log(`Sky data: cache ${rel(options.cache) || '.'}, output ${rel(options.out)}`);
  log('Sources');
  const bsc = await ensureSource(SOURCES.bsc);
  const names = await ensureSource(SOURCES.names);
  const milkyWay = await ensureSource(SOURCES.milkyWay);

  // Stars.
  const catalogBytes = zlib.gunzipSync(fs.readFileSync(bsc.catalog.path), { maxOutputLength: 8 << 20 });
  const catalogSha256 = sha256(catalogBytes);
  checkPin('bscCatalog', catalogSha256);
  const { stars, removed, negativeParallax } = parseBsc(catalogBytes.toString('latin1'));
  const notesBytes = zlib.gunzipSync(fs.readFileSync(bsc.notes.path), { maxOutputLength: 16 << 20 });
  const notesSha256 = sha256(notesBytes);
  checkPin('bscNotes', notesSha256);
  const remarks = applyRemarks(stars, notesBytes.toString('latin1'));
  for (const r of remarks) log(`From the catalogue's remark: HR ${r.hr} V ${r.vmag[0]} to ${r.vmag[1]}, B-V ${r.bv[0]} to ${r.bv[1]}`);
  const colors = estimateMissingColors(stars);
  stars.sort((a, b) => a.vmag - b.vmag || a.hr - b.hr);
  const starBytes = encodeStars(stars);
  if (starBytes.length >= STARS_BUDGET) throw new Error(`stars.bin is ${starBytes.length} bytes, over the ${STARS_BUDGET}-byte budget.`);
  const decoded = decodeStars(starBytes);
  let worst = 0;
  stars.forEach((s, i) => {
    worst = Math.max(worst, separation(s.ra, s.dec, decoded.ra[i], decoded.dec[i]));
    if (decoded.hr[i] !== s.hr || Math.abs(decoded.vmag[i] - s.vmag) > 0.001 || Math.abs(decoded.bv[i] - s.bv) > 0.001 || decoded.parallax[i] !== s.parallax) {
      throw new Error(`stars.bin does not read back HR ${s.hr} as written.`);
    }
  });
  if (worst > 1) throw new Error(`stars.bin moves a star by ${worst.toFixed(2)} arcsec.`);
  log(`Stars: ${stars.length} (${removed.length} non-stellar entries left out), ${colors.count} B-V estimated, ${countBrighterThan(decoded, 5.35)} at V 5.35 or brighter, worst position error ${worst.toFixed(3)} arcsec`);

  // Names.
  const csn = parseCsn(fs.readFileSync(names.page.path, 'utf8'));
  const { named, report } = joinNames(csn.rows, stars);
  const namesJson = {};
  const kept = [];
  for (let i = 0; i < stars.length && kept.length < NAMED_STARS; i += 1) {
    const entry = named.get(stars[i].hr);
    if (!entry) continue;
    namesJson[i] = entry.name;
    kept.push({ index: i, hr: stars[i].hr, vmag: stars[i].vmag, name: entry.name });
  }
  if (kept.length !== NAMED_STARS) throw new Error(`Only ${kept.length} catalogue stars have IAU names.`);
  const adoption = csn.rows.map((row) => row.adopted.replace(/\//g, '-')).filter((d) => /^\d{4}-\d\d-\d\d$/.test(d)).sort();
  log(`Names: ${csn.rows.length} rows read, ${named.size} joined (${report.hr} by HR, ${report.hd} by HD, ${report.position.length} by position), ${report.outside} HR or HD numbers outside the catalogue`);
  for (const line of report.position) log(`  by position  ${line}`);
  if (report.slipUndone.length) log(`  right ascension slip undone for: ${report.slipUndone.join(', ')}`);
  for (const line of [...csn.rejected, ...report.rejected]) log(`  left out     ${line}`);
  log(`  other designations with no catalogue star at their position: ${report.unmatched.length} (stars outside the catalogue, or rows with broken coordinates)`);
  // A name that could not be joined could belong among the kept ones: say so, for a check by hand.
  const faintest = kept.at(-1).vmag;
  for (const row of report.unmatched.filter((r) => r.mag <= faintest + 0.5)) {
    log(`  CHECK BY HAND ${row.name} (${row.designation}, ${row.bayer}) is not joined, and the page gives it magnitude ${row.mag}`);
  }
  log(`  kept ${kept.length}: from ${kept[0].name} (V ${kept[0].vmag}) to ${kept.at(-1).name} (V ${kept.at(-1).vmag})`);
  const beyondLatin1 = kept.filter((k) => [...k.name].some((ch) => ch.codePointAt(0) > 0xff));
  const accented = kept.filter((k) => [...k.name].some((ch) => ch.codePointAt(0) > 0x7f));
  if (accented.length) log(`  names with letters beyond ASCII: ${accented.map((k) => k.name).join(', ')}${beyondLatin1.length ? ` (beyond Latin-1: ${beyondLatin1.map((k) => k.name).join(', ')})` : ''}`);
  if (Object.values(namesJson).some((name) => DASHES.test(name))) throw new Error('A star name holds an en dash or an em dash.');

  // Milky Way.
  checkPin('esoJpeg', milkyWay.jpeg.record.sha256);
  log('Milky Way: resampling in Chrome');
  const mw = await buildMilkyWay(milkyWay.jpeg.path);
  checkGalacticLayout(mw);
  const webp2k = Buffer.from(mw.webp2k, 'base64');
  const webp4k = Buffer.from(mw.webp4k, 'base64');
  for (const [bytes, w, h] of [[webp2k, 2048, 1024], [webp4k, 4096, 2048]]) {
    const info = webpInfo(bytes);
    if (info.width !== w || info.height !== h) throw new Error(`A Milky Way WebP is ${info.width} x ${info.height}, expected ${w} x ${h}.`);
  }
  if (webp2k.length >= MILKY_WAY_2K_BUDGET) throw new Error(`milkyway-2k.webp is ${webp2k.length} bytes, over the budget.`);
  log(`  source ${mw.source.width} x ${mw.source.height}${mw.source.icc ? ' (with an ICC profile, converted to sRGB)' : ''}, Chrome ${mw.chrome}, WebP quality ${mw.quality} (tried ${mw.tried.map(([q, s]) => `${q}: ${kB(s)}`).join(', ')})`);
  log(`  layout: band brightest at l ${mw.centreLongitude.toFixed(1)}, plane at b ${mw.planeLatitude.toFixed(1)}; ${Object.entries(mw.clouds).map(([k, c]) => `${k} contrast ${c.atPlace.toFixed(2)} (mirrored ${c.mirroredInLongitude.toFixed(2)}, ${c.mirroredInLatitude.toFixed(2)})`).join('; ')}`);

  // Write.
  fs.mkdirSync(options.out, { recursive: true });
  const outputs = {
    'stars.bin': starBytes,
    'names.json': `${JSON.stringify(namesJson, null, 2)}\n`,
    'milkyway-2k.webp': webp2k,
    'milkyway-4k.webp': webp4k,
  };
  outputs['CREDITS.md'] = credits({
    bsc,
    names,
    milkyWay,
    starsInfo: {
      count: stars.length,
      removed: removed.length,
      bytes: starBytes.length,
      catalogSha256,
      notesSha256,
      remarks,
      bvEstimated: colors.count,
      bvBySubclass: colors.subclass,
      bvByClass: colors.class,
      bvByCatalogue: colors.catalogue,
      negativeParallax,
    },
    namesInfo: { joined: named.size, kept: kept.length, byPosition: report.position.length, slipUndone: report.slipUndone.length, newestAdoption: adoption.at(-1) || 'unknown' },
    mw: { ...mw, size2k: webp2k.length, size4k: webp4k.length },
  });
  log('Wrote');
  for (const [name, content] of Object.entries(outputs)) {
    const file = path.join(options.out, name);
    fs.writeFileSync(file, content);
    log(`  ${rel(file).padEnd(30)} ${String(fs.statSync(file).size).padStart(9)} bytes`);
  }
}

main().catch((error) => {
  console.error(`build-sky failed: ${error.message}`);
  process.exit(1);
});
