#!/usr/bin/env node
/**
 * Full-page screenshots of the review pages at the four widths of ARCHITECTURE.md 15 (390, 768,
 * 1024, 1440 px) in both themes, into screenshots/<label>/ (ignored by git).
 *
 *   npm run build && npx next start -p 3000      (in one terminal)
 *   npm run screenshots -- --base http://localhost:3000 --label phase-3
 *
 * Uses the installed Google Chrome through Playwright (or CHROME_PATH). Very tall pages are
 * captured in slices, because Chrome cannot paint one image taller than about 16,000 px.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const base = arg('base', 'http://localhost:3000').replace(/\/+$/, '');
const label = arg('label', 'latest');
const pages = (arg('pages', '/,/projects/raven,/about')).split(',');
const widths = (arg('widths', '390,768,1024,1440')).split(',').map(Number);
const themes = ['dark', 'light'];
const out = path.join(root, 'screenshots', label);
fs.mkdirSync(out, { recursive: true });

const SLICE = 12000;
const slug = (route) => (route === '/' ? 'home' : route.replace(/^\//, '').replace(/\//g, '-'));

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' });
const problems = [];
try {
  for (const theme of themes) {
    for (const width of widths) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        deviceScaleFactor: 1,
        reducedMotion: 'reduce',
        isMobile: width < 768,
        hasTouch: width < 1024,
      });
      await context.addCookies([{ name: 'theme', value: theme, url: base }]);
      const page = await context.newPage();
      page.on('pageerror', (error) => problems.push(`${theme} ${width} ${page.url()}: ${error.message}`));
      for (const route of pages) {
        await page.goto(`${base}${route}`, { waitUntil: 'networkidle' });
        // Bring every lazy image into view once, then wait until each has loaded.
        await page.evaluate(async () => {
          const step = Math.max(400, Math.floor(window.innerHeight * 0.8));
          for (let y = 0; y < document.body.scrollHeight; y += step) {
            window.scrollTo(0, y);
            await new Promise((r) => setTimeout(r, 120));
          }
          window.scrollTo(0, 0);
          await Promise.all(
            Array.from(document.images).map((img) =>
              img.complete ? null : new Promise((r) => { img.addEventListener('load', r, { once: true }); img.addEventListener('error', r, { once: true }); }),
            ),
          );
        });
        await page.waitForLoadState('networkidle');
        const height = await page.evaluate(() => document.documentElement.scrollHeight);
        const name = `${slug(route)}-${width}-${theme}`;
        if (height <= SLICE) {
          await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: true });
        } else {
          // Slices of the page, top to bottom, through a tall viewport.
          let part = 1;
          for (let y = 0; y < height; y += SLICE, part += 1) {
            const h = Math.min(SLICE, height - y);
            await page.setViewportSize({ width, height: h });
            await page.evaluate((top) => window.scrollTo(0, top), y);
            await page.waitForTimeout(200);
            await page.screenshot({ path: path.join(out, `${name}-part${part}.png`) });
          }
          await page.setViewportSize({ width, height: 900 });
        }
        console.log(`${name}: ${height}px`);
      }
      await context.close();
    }
  }
} finally {
  await browser.close();
}
if (problems.length) {
  console.log(problems.join('\n'));
  process.exitCode = 1;
}
console.log(`screenshots in ${path.relative(root, out)}`);
