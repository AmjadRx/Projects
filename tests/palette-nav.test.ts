/**
 * The nav's search button in the server render (components/site/Nav.tsx, components/palette/
 * PaletteTrigger.tsx): it renders closed with its name, shortcut, icon and words, and no palette
 * markup; the palette's code is not part of the button's module graph (it loads on demand); and,
 * laid out by a real browser with the site's own stylesheets and fonts, the nav does not overflow
 * at 390 px, nor at 768, 1024, 1280 or 1440, with the button a 44 px target at each.
 *
 * The layout check needs Google Chrome (playwright-core, channel "chrome", or CHROME_PATH); where
 * no browser can start it is skipped and says so.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createElement, type ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import Nav from '../components/site/Nav';
import { navItemsFor, siteData, socialLinksFor } from '../lib/site';
import { themeFromSetting } from '../lib/theme';

vi.mock('next/navigation', () => ({ usePathname: () => '/' }));
vi.mock('next/link', async () => {
  const { createElement: h } = await import('react');
  return {
    default: ({ href, children, prefetch: _prefetch, ...rest }: { href: string; children: ReactNode; prefetch?: boolean }) => h('a', { href, ...rest }, children),
  };
});

const root = path.resolve(__dirname, '..');

/** The nav exactly as SiteChrome builds it from the seed. */
function navHtml(): string {
  const { site, resolveLink } = siteData();
  return renderToString(
    createElement(Nav, {
      name: site.personal.name,
      items: navItemsFor(site, resolveLink),
      socials: socialLinksFor(site, 'nav'),
      availability: site.settings.showAvailabilityBadge ? site.personal.availability : undefined,
      theme: themeFromSetting(site.settings.themeDefault),
    }),
  );
}

describe('the server render', () => {
  const html = navHtml();

  it('draws the search button closed, with its name, its shortcut and its dialog kind', () => {
    const button = /<button[^>]*class="ar-nav__search"[^>]*>/.exec(html)?.[0] ?? '';
    expect(button).not.toBe('');
    expect(button).toContain('type="button"');
    expect(button).toContain('aria-label="Search pages and projects"');
    expect(button).toContain('aria-keyshortcuts="Control+K Meta+K"');
    expect(button).toContain('aria-haspopup="dialog"');
    expect(button).toContain('aria-expanded="false"');
    expect(button).not.toContain('aria-controls');
  });

  it("draws the button's icon, its word and its shortcut on the server", () => {
    const inner = /<button[^>]*class="ar-nav__search"[^>]*>([\s\S]*?)<\/button>/.exec(html)?.[1] ?? '';
    expect(inner).toMatch(/<svg[^>]*class="lucide lucide-search ar-icon"[^>]*aria-hidden="true"/);
    expect(inner).toContain('<span class="ar-nav__search-text">Search</span>');
    expect(inner).toContain('<kbd class="ar-nav__kbd">Ctrl K</kbd>');
  });

  it('places it after the social links and before the theme toggle and Menu, as the bundle does', () => {
    const at = (needle: string) => html.indexOf(needle);
    expect(at('ar-nav__social')).toBeLessThan(at('ar-nav__search'));
    expect(at('ar-nav__search')).toBeLessThan(at('ar-theme'));
    expect(at('ar-theme')).toBeLessThan(at('ar-menubtn'));
  });

  it('draws no palette until it is asked for', () => {
    expect(html).not.toContain('ar-cmdk');
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain('role="combobox"');
  });

  it("keeps the palette's code out of the button's first load: only a dynamic import reaches it", () => {
    const source = (file: string) => fs.readFileSync(path.join(root, 'components', 'palette', file), 'utf8');
    const statics = (text: string) => [...text.matchAll(/^import\s+(?!type\b)[^;]*?from\s+'([^']+)'/gm)].map((m) => m[1]);
    for (const file of ['PaletteTrigger.tsx', 'load.ts', 'shortcut.ts']) {
      expect(statics(source(file)), file).not.toContain('./CommandPalette');
      expect(statics(source(file)), file).not.toContain('./model');
      expect(statics(source(file)), file).not.toContain('@/lib/strings');
      expect(statics(source(file)), file).not.toContain('@/lib/palette');
    }
    expect(source('load.ts')).toContain("import('./CommandPalette')");
  });
});

/**
 * The stylesheets the nav's layout reads, in the site's order (app/layout.tsx), with Tailwind's
 * base layer (its preflight, which app/globals.css pulls in) built from the site's own config, so
 * the page is laid out as the site is.
 */
async function siteCss(): Promise<string> {
  const { default: postcss } = await import('postcss');
  const { default: tailwind } = await import('tailwindcss');
  const { default: config } = await import('../tailwind.config');
  const files = ['tokens.css', 'globals.css', 'sheet.css', 'motion-chrome.css', 'styles/frame.css', 'palette.css'];
  const css = files.map((file) => fs.readFileSync(path.join(root, 'app', file), 'utf8')).join('\n');
  const built = await postcss([tailwind({ ...config, content: [{ raw: '', extension: 'html' }] })]).process(css, { from: undefined });
  return built.css;
}

/** The site's own fonts, as next/font names them (app/layout.tsx), inlined so the page needs no server. */
function fontCss(): string {
  const font = (file: string) => fs.readFileSync(path.join(root, 'app', 'fonts', file)).toString('base64');
  return `
    @font-face { font-family: 'Archivo Test'; src: url(data:font/woff2;base64,${font('Archivo-Variable.woff2')}) format('woff2'); font-weight: 100 900; font-stretch: 62% 125%; }
    @font-face { font-family: 'B612 Mono Test'; src: url(data:font/woff2;base64,${font('B612Mono-Regular.woff2')}) format('woff2'); font-weight: 400; }
    :root { --font-archivo: 'Archivo Test'; --font-b612-mono: 'B612 Mono Test'; }`;
}

async function launch() {
  try {
    const { chromium } = await import('playwright-core');
    return await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' });
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

describe('the nav laid out in a browser', () => {
  it('does not overflow at 390 px or any other width, and the button is a 44 px target', { timeout: 90_000 }, async (context) => {
    const browser = await launch();
    if (typeof browser === 'string') {
      context.skip(`no browser could start: ${browser.split('\n')[0]}`);
      return;
    }
    try {
      const page = await browser.newPage();
      const css = await siteCss();
      expect(css).toMatch(/body\s*{[^}]*margin:\s*0/);
      for (const theme of ['blueprint', 'whiteprint']) {
        await page.setContent(
          `<!doctype html><html lang="en" data-theme="${theme}"><head><style>${fontCss()}${css}</style></head>` +
            `<body><div class="ar-frame ar-page hm"><div class="hm-body">${navHtml()}</div></div></body></html>`,
        );
        await page.evaluate(async () => {
          await Promise.all([...document.fonts].map((face) => face.load()));
          await document.fonts.ready;
        });
        for (const width of [390, 768, 1024, 1280, 1440]) {
          await page.setViewportSize({ width, height: 800 });
          const report = await page.evaluate(() => {
            const inner = document.querySelector('.ar-nav__in') as HTMLElement;
            const style = getComputedStyle(inner);
            const box = inner.getBoundingClientRect();
            const right = box.right - parseFloat(style.paddingRight);
            const left = box.left + parseFloat(style.paddingLeft);
            const parts = [...inner.querySelectorAll<HTMLElement>(':scope > *, .ar-nav__tools > *, .ar-nav__links > li')].filter(
              (el) => el.getClientRects().length > 0,
            );
            const outside = parts
              .filter((el) => el.getBoundingClientRect().right > right + 0.5 || el.getBoundingClientRect().left < left - 0.5)
              .map((el) => el.className || el.tagName);
            const button = (document.querySelector('.ar-nav__search') as HTMLElement).getBoundingClientRect();
            const fonts = [...document.fonts].filter((face) => face.status === 'loaded').map((face) => face.family);
            return {
              innerOverflow: inner.scrollWidth - inner.clientWidth,
              pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
              outside,
              button: { width: button.width, height: button.height, right: button.right },
              right,
              fonts,
              word: getComputedStyle(document.querySelector('.ar-nav__search-text') as HTMLElement).display,
              kbd: getComputedStyle(document.querySelector('.ar-nav__kbd') as HTMLElement).display,
            };
          });
          const where = `${theme} ${width}px`;
          expect(report.fonts, where).toContain('Archivo Test');
          expect(report.innerOverflow, where).toBeLessThanOrEqual(0);
          expect(report.pageOverflow, where).toBeLessThanOrEqual(0);
          expect(report.outside, where).toEqual([]);
          expect(report.button.height, where).toBeGreaterThanOrEqual(44);
          expect(report.button.width, where).toBeGreaterThanOrEqual(44);
          expect(report.button.right, where).toBeLessThanOrEqual(report.right + 0.5);
          // The icon alone under 1024 px; the shortcut from 1024 px; the word from 1280 px.
          expect(report.kbd !== 'none', where).toBe(width >= 1024);
          expect(report.word !== 'none', where).toBe(width >= 1280);
        }
      }
    } finally {
      await browser.close();
    }
  });
});
