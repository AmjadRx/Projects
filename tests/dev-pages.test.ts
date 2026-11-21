/**
 * The development pages never ship to production (ARCHITECTURE.md 14, Phase 3: "removed before
 * release"): /dev/blocks, /dev-convert, /dev-media and /dev-sky answer not found on a production
 * deployment and work in local development and on preview deployments (lib/devPages.ts). Vercel
 * says which deployment a build or a request belongs to in VERCEL_ENV; NODE_ENV is "production"
 * in every Vercel build, previews included.
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { devPagesEnabled } from '../lib/devPages';

// The harnesses are browser tools; the pages are tested here for their gate only.
vi.mock('@/components/admin/dev/ConvertHarness', () => ({ default: () => null }));
vi.mock('@/components/admin/media/dev/MediaHarness', () => ({ default: () => null, RealHarness: () => null }));
vi.mock('@/components/sky/dev/SkyHarness', () => ({ default: () => null }));
vi.mock('@/components/blocks/BlockRenderer', () => ({ default: () => null }));
vi.mock('../app/(site)/dev/blocks/blocks.module.css', () => ({ default: {} }));
vi.mock('../app/admin/admin.css', () => ({}));

const ROOT = path.resolve(__dirname, '..');

/** The four pages, with how each is called. */
const PAGES = [
  { file: 'app/(site)/dev/blocks/page.tsx', load: () => import('../app/(site)/dev/blocks/page'), props: undefined },
  { file: 'app/dev-convert/page.tsx', load: () => import('../app/dev-convert/page'), props: undefined },
  { file: 'app/dev-media/page.tsx', load: () => import('../app/dev-media/page'), props: { searchParams: {} } },
  { file: 'app/dev-sky/page.tsx', load: () => import('../app/dev-sky/page'), props: { searchParams: {} } },
] as const;

/** Calls a page and says whether it answered not found. */
async function answersNotFound(page: (typeof PAGES)[number]): Promise<boolean> {
  const { default: Page } = await page.load();
  try {
    (Page as (props?: unknown) => unknown)(page.props);
    return false;
  } catch (error) {
    if (error instanceof Error && error.message === 'NEXT_NOT_FOUND') return true;
    throw error;
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('devPagesEnabled', () => {
  it('is off on a production deployment', () => {
    expect(devPagesEnabled({ VERCEL_ENV: 'production', NODE_ENV: 'production' })).toBe(false);
    // Whatever NODE_ENV says.
    expect(devPagesEnabled({ VERCEL_ENV: 'production', NODE_ENV: 'development' })).toBe(false);
  });

  it('is on for a preview deployment, although NODE_ENV is "production" there', () => {
    expect(devPagesEnabled({ VERCEL_ENV: 'preview', NODE_ENV: 'production' })).toBe(true);
  });

  it('is on in local development, with or without the Vercel CLI', () => {
    expect(devPagesEnabled({ NODE_ENV: 'development' })).toBe(true);
    expect(devPagesEnabled({ VERCEL_ENV: 'development', NODE_ENV: 'development' })).toBe(true);
  });

  it('fails closed anywhere else: a local production build, CI, tests, an unknown deployment', () => {
    expect(devPagesEnabled({ NODE_ENV: 'production' })).toBe(false);
    expect(devPagesEnabled({ NODE_ENV: 'test' })).toBe(false);
    expect(devPagesEnabled({})).toBe(false);
    expect(devPagesEnabled({ VERCEL_ENV: 'staging', NODE_ENV: 'production' })).toBe(false);
    expect(devPagesEnabled({ VERCEL_ENV: '', NODE_ENV: 'production' })).toBe(false);
  });
});

describe('the four development pages', () => {
  it('all ask the one gate, and none reads NODE_ENV itself', () => {
    for (const page of PAGES) {
      const source = fs.readFileSync(path.join(ROOT, page.file), 'utf8');
      expect(source, page.file).toMatch(/import \{ devPagesEnabled \} from '@\/lib\/devPages';/);
      expect(source, page.file).toMatch(/if \(!devPagesEnabled\(\)\) notFound\(\);/);
      expect(source, page.file).not.toMatch(/process\.env\.NODE_ENV/);
    }
  });

  it('answer not found on a production deployment', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    for (const page of PAGES) expect(await answersNotFound(page), page.file).toBe(true);
  }, 120_000);

  it('render on a preview deployment and in local development', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    for (const page of PAGES) expect(await answersNotFound(page), page.file).toBe(false);
    vi.unstubAllEnvs();
    vi.stubEnv('VERCEL_ENV', '');
    vi.stubEnv('NODE_ENV', 'development');
    for (const page of PAGES) expect(await answersNotFound(page), page.file).toBe(false);
  }, 120_000);

  it("leave no trace in a production 404: /dev/blocks's title answers to the same gate", async () => {
    const { generateMetadata } = await import('../app/(site)/dev/blocks/page');
    vi.stubEnv('VERCEL_ENV', 'production');
    expect(() => generateMetadata()).toThrow('NEXT_NOT_FOUND');
    vi.stubEnv('VERCEL_ENV', 'preview');
    expect(generateMetadata()).toMatchObject({ title: 'Block samples', robots: { index: false, follow: false } });
  }, 120_000);

  it('stay out of the sitemap', () => {
    const sitemap = fs.readFileSync(path.join(ROOT, 'app/sitemap.ts'), 'utf8');
    expect(sitemap).not.toMatch(/\/dev/);
  });
});
