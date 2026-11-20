/**
 * SEO across the routes (ARCHITECTURE.md 5 and 15, item 2), on content fixtures built from a copy
 * of content/ (tests/fixtures/seo-content.ts), never the seed itself: a hidden project, and fields
 * left empty, leave nothing in any page's metadata, the JSON-LD, the sitemap, robots.txt, the
 * manifest, or the Open Graph image routes (their static params, their drawn words, their alt
 * text); every public page has a title, a description when the content has one, a canonical
 * address, and Open Graph and Twitter fields with its share image; the GPA is only ever "Major GPA
 * 3.65"; and the icon, the favicon, and the images are real PNG and ICO files of the right size.
 * The build-level search of every output file is tests/build/hiding.test.ts.
 */
import fs from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { initials } from '../lib/og/cards';
import { EMPTIED_SLUG, gpaOnlyLabelled, HIDDEN, HIDDEN_MARKERS, makeSeoFixture, stringsOf } from './fixtures/seo-content';

// next/font/local only runs inside Next's compiler; the root layout's fonts are not under test.
vi.mock('next/font/local', () => ({ default: () => ({ variable: 'font', className: 'font' }) }));

const PAGES = {
  '/': '../app/(site)/page',
  '/projects': '../app/(site)/projects/page',
  '/about': '../app/(site)/about/page',
  '/experience': '../app/(site)/experience/page',
  '/log': '../app/(site)/log/page',
  '/contact': '../app/(site)/contact/page',
} as const;

/** The app's SEO surface, imported fresh against one content folder. */
async function loadApp(dir: string) {
  process.env.SITE_CONTENT_DIR = dir;
  vi.resetModules();
  const pages = Object.fromEntries(
    await Promise.all(Object.entries(PAGES).map(async ([route, mod]) => [route, (await import(mod)) as { generateMetadata: () => any }])),
  ) as Record<keyof typeof PAGES, { generateMetadata: () => any }>;
  return {
    pages,
    project: await import('../app/(site)/projects/[slug]/page'),
    layout: await import('../app/layout'),
    sitemap: (await import('../app/sitemap')).default,
    robots: (await import('../app/robots')).default,
    manifest: (await import('../app/manifest')).default,
    homeImage: await import('../app/opengraph-image'),
    projectImage: await import('../app/(site)/projects/[slug]/opengraph-image'),
    icon: await import('../app/icon'),
    appleIcon: await import('../app/apple-icon'),
    favicon: await import('../app/favicon.ico/route'),
    site: await import('../lib/site'),
    data: await import('../lib/structured-data'),
    history: await import('../lib/history'),
    cards: await import('../lib/og/site-cards'),
    sheet: await import('../lib/og/sheet'),
  };
}

type App = Awaited<ReturnType<typeof loadApp>>;

/** Every page's metadata, the project pages' too, as one list of [route, metadata]. */
async function allMetadata(app: App): Promise<[string, any][]> {
  const out: [string, any][] = Object.entries(app.pages).map(([route, mod]) => [route, mod.generateMetadata()]);
  for (const { slug } of app.project.generateStaticParams()) {
    out.push([`/projects/${slug}`, await app.project.generateMetadata({ params: Promise.resolve({ slug }) })]);
  }
  return out;
}

function pngSize(bytes: Uint8Array): { width: number; height: number } {
  expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

const leaks = (strings: readonly string[]) => strings.filter((s) => HIDDEN_MARKERS.some((m) => s.includes(m)));

describe('with a hidden project and emptied fields', () => {
  let dir = '';
  let app: App;

  beforeAll(async () => {
    dir = makeSeoFixture({ emptied: true });
    app = await loadApp(dir);
  }, 120_000);

  afterAll(() => {
    delete process.env.SITE_CONTENT_DIR;
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('keeps the hidden project out of every page list the site builds from', () => {
    const { projects } = app.site.siteData();
    expect(projects.some((p) => p.slug === HIDDEN.slug)).toBe(false);
    expect(app.project.generateStaticParams().map((p) => p.slug)).not.toContain(HIDDEN.slug);
  });

  it('gives the hidden project no Open Graph image: not in the static params, and no card', async () => {
    const params = app.projectImage.generateStaticParams();
    expect(params).toEqual(app.project.generateStaticParams());
    expect(params.map((p) => p.slug)).not.toContain(HIDDEN.slug);
    expect(app.projectImage.dynamicParams).toBe(false);
    expect(app.cards.siteProjectCard(HIDDEN.slug)).toBeNull();
    await expect(app.projectImage.default({ params: { slug: HIDDEN.slug } })).rejects.toThrow(/NEXT_NOT_FOUND/);
  });

  it('numbers the sheets among the visible projects only', () => {
    const visible = app.site.siteData().projects;
    visible.forEach((p, i) => {
      const card = app.cards.siteProjectCard(p.slug)!;
      expect(card.sheet).toBe(i + 1);
      expect(card.sheets).toBe(visible.length);
    });
  });

  it('draws nothing of the hidden project, and no label for an emptied field, on any image', () => {
    const drawn = [app.cards.siteHomeCard(), ...app.projectImage.generateStaticParams().map(({ slug }) => app.cards.siteProjectCard(slug)!)].flatMap(
      (card) => app.sheet.drawnText(card),
    );
    expect(leaks(drawn)).toEqual([]);
    const emptied = app.sheet.drawnText(app.cards.siteProjectCard(EMPTIED_SLUG)!);
    for (const label of ['ROLE', 'DATES', 'MATURITY']) expect(emptied, label).not.toContain(label);
    // The status falls back to the status value in sentence case, as on the page.
    expect(emptied).toContain('STATUS');
  });

  it('leaves nothing of the hidden project in any metadata, and no empty description or image alt', async () => {
    const metadata = await allMetadata(app);
    expect(leaks(metadata.flatMap(([, m]) => stringsOf(m)))).toEqual([]);
    expect(leaks(stringsOf(app.layout.generateMetadata()))).toEqual([]);
    for (const [route, m] of metadata) {
      // seo.description and the emptied pitch are empty: no description anywhere.
      if (route === '/' || route.startsWith('/projects/' + EMPTIED_SLUG) || !route.startsWith('/projects/')) {
        expect(m.description, route).toBeUndefined();
        expect(m.openGraph.description, route).toBeUndefined();
        expect(m.twitter.description, route).toBeUndefined();
      }
      for (const s of stringsOf(m)) expect(s.trim(), route).not.toBe('');
    }
    const moon = metadata.find(([route]) => route === `/projects/${EMPTIED_SLUG}`)![1];
    const alt: string = moon.openGraph.images[0].alt;
    for (const label of ['Role:', 'Dates:', 'Maturity:', ': .', '..']) expect(alt, label).not.toContain(label);
    // The title, then straight to the sheet number: the emptied subtitle leaves no sentence.
    const title = app.site.siteData().projects.find((p) => p.slug === EMPTIED_SLUG)!.title;
    expect(alt.startsWith(`${title}. Sheet `)).toBe(true);
  });

  it('builds JSON-LD from shown fields only, leaving the emptied ones out', () => {
    const person = app.data.personJsonLd(app.site.siteData().site);
    expect(person['@type']).toBe('Person');
    for (const key of ['description', 'affiliation', 'image', 'telephone', 'alumniOf']) expect(person, key).not.toHaveProperty(key);
    const { site, projects } = app.site.siteData();
    for (const project of projects) {
      const work = app.data.creativeWorkJsonLd(site, project, app.history.projectRevDate(project.slug));
      expect(leaks(stringsOf(work)), project.slug).toEqual([]);
    }
    const moon = projects.find((p) => p.slug === EMPTIED_SLUG)!;
    const work = app.data.creativeWorkJsonLd(site, moon, undefined);
    for (const key of ['alternativeHeadline', 'description', 'image', 'dateModified']) expect(work, key).not.toHaveProperty(key);
    // No role: the owner is a plain contributor, never an author.
    expect(work.contributor).toEqual({ '@type': 'Person', name: site.personal.name, url: 'https://amjadrehawi.com' });
    expect(work).not.toHaveProperty('author');
  });

  it('lists only the visible pages in the sitemap, and no private path in it or in robots.txt', () => {
    const urls = app.sitemap().map((entry) => entry.url);
    const visible = app.site.siteData().projects.map((p) => `https://amjadrehawi.com/projects/${p.slug}`);
    expect(urls).toEqual([
      'https://amjadrehawi.com',
      ...['/projects', '/about', '/experience', '/log', '/contact'].map((r) => `https://amjadrehawi.com${r}`),
      ...visible,
    ]);
    const robots = JSON.stringify(app.robots());
    for (const text of [JSON.stringify(app.sitemap()), robots]) {
      expect(leaks([text])).toEqual([]);
      for (const path of ['/admin', '/api', '/dev', '/dev-convert', '/dev-media', '/dev-sky']) expect(text).not.toContain(`"${path}`);
      expect(text).not.toMatch(/admin|\/api\b|dev-|\/dev\//);
    }
    expect(app.robots()).toEqual({ rules: [{ userAgent: '*', allow: '/' }], sitemap: 'https://amjadrehawi.com/sitemap.xml' });
  });

  it('leaves the emptied description out of the manifest', () => {
    const manifest = app.manifest();
    expect(manifest).not.toHaveProperty('description');
    expect(leaks(stringsOf(manifest))).toEqual([]);
  });
});

describe('with the GPA and every field present (plus a hidden project)', () => {
  let dir = '';
  let app: App;

  beforeAll(async () => {
    dir = makeSeoFixture({ emptied: false });
    app = await loadApp(dir);
  }, 120_000);

  afterAll(() => {
    delete process.env.SITE_CONTENT_DIR;
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('gives every public page a title, a description, a canonical address, and its share image', async () => {
    const { site } = app.site.siteData();
    for (const [route, m] of await allMetadata(app)) {
      const isProject = route.startsWith('/projects/');
      if (route !== '/') expect(m.title, route).toBeTruthy();
      expect(m.description, route).toBeTruthy();
      expect(m.alternates.canonical, route).toBe(route);
      expect(m.openGraph, route).toMatchObject({ type: 'website', siteName: site.personal.name, url: route });
      expect(m.openGraph.title, route).toBeTruthy();
      const [image] = m.openGraph.images;
      expect(image, route).toMatchObject({ width: 1200, height: 630, type: 'image/png' });
      expect(image.url, route).toMatch(isProject ? /^\/projects\/[a-z0-9-]+\/opengraph-image-[a-z0-9]+\?v=[0-9a-f]{10}$/ : /^\/opengraph-image\?v=[0-9a-f]{10}$/);
      expect(image.alt, route).toBeTruthy();
      expect(m.twitter, route).toMatchObject({ card: 'summary_large_image', images: [{ url: image.url, alt: image.alt }] });
      expect(m.twitter.title, route).toBe(m.openGraph.title);
      expect(m.robots, route).toBeUndefined();
    }
  });

  it('names each project image with its own address and an alt text read from its title block', async () => {
    for (const { slug } of app.project.generateStaticParams()) {
      const m = await app.project.generateMetadata({ params: Promise.resolve({ slug }) });
      const card = app.cards.siteProjectCard(slug)!;
      const image = (m.openGraph as any).images[0];
      expect(image.url.startsWith(`/projects/${slug}/opengraph-image-`)).toBe(true);
      expect(image.alt.startsWith(`${card.title}.`)).toBe(true);
      if (card.role) expect(image.alt).toContain(`Role: ${card.role}.`);
      if (card.maturity) expect(image.alt).toContain(`Maturity: ${card.maturity.label}`);
    }
    // The root layout names no image: pages that name none get the home image file and its alt.
    const root = app.layout.generateMetadata();
    expect(root.openGraph).not.toHaveProperty('images');
    expect(root.twitter).toMatchObject({ card: 'summary_large_image' });
    const { personal } = app.site.siteData().site;
    const headline = /[.!?]$/.test(personal.tagline) ? personal.tagline : `${personal.tagline}.`;
    expect(app.homeImage.alt).toBe(`${headline} Name: ${personal.name}.`);
  });

  it('prints the GPA only as "Major GPA 3.65" in the metadata, the JSON-LD, the manifest, and the images', async () => {
    expect(gpaOnlyLabelled(['GPA 3.65'])).toBe(false);
    expect(gpaOnlyLabelled(['Major GPA 3.65', 'nothing'])).toBe(true);
    const { site, projects } = app.site.siteData();
    const strings = [
      ...(await allMetadata(app)).flatMap(([, m]) => stringsOf(m)),
      ...stringsOf(app.layout.generateMetadata()),
      ...stringsOf(app.data.personJsonLd(site)),
      ...projects.flatMap((p) => stringsOf(app.data.creativeWorkJsonLd(site, p, app.history.projectRevDate(p.slug)))),
      ...stringsOf(app.manifest()),
      ...stringsOf(app.sitemap()),
      app.homeImage.alt,
      ...[app.cards.siteHomeCard(), ...projects.map((p) => app.cards.siteProjectCard(p.slug)!)].flatMap((card) => app.sheet.drawnText(card)),
    ];
    expect(strings.length).toBeGreaterThan(100);
    expect(gpaOnlyLabelled(strings)).toBe(true);
    expect(leaks(strings)).toEqual([]);
  });

  it('builds the Person and CreativeWork JSON-LD from shown fields', () => {
    const { site, projects } = app.site.siteData();
    const person = app.data.personJsonLd(site);
    expect(person).toEqual({
      '@context': 'https://schema.org',
      '@type': 'Person',
      name: site.personal.name,
      url: 'https://amjadrehawi.com',
      description: site.personal.subTagline,
      email: `mailto:${site.personal.email}`,
      affiliation: { '@type': 'CollegeOrUniversity', name: site.personal.school },
      image: `https://amjadrehawi.com${site.personal.photo!.src}`,
      // The LinkedIn and GitHub profiles among the footer links; not the scheduling link or the phone.
      sameAs: site.socialLinks.filter((l) => l.showInFooter && /^https:\/\/(www\.)?(linkedin|github)\.com\//.test(l.url)).map((l) => l.url),
    });
    expect(person.sameAs?.length).toBeGreaterThan(0);
    const raven = projects.find((p) => p.slug === 'raven')!;
    expect(app.data.creativeWorkJsonLd(site, raven, '2026-11-17')).toEqual({
      '@context': 'https://schema.org',
      '@type': 'CreativeWork',
      name: raven.title,
      alternativeHeadline: raven.subtitle,
      description: raven.pitch,
      url: 'https://amjadrehawi.com/projects/raven',
      contributor: { '@type': 'Role', roleName: raven.role, contributor: { '@type': 'Person', name: site.personal.name, url: 'https://amjadrehawi.com' } },
      image: `https://amjadrehawi.com${raven.cover.src}`,
      dateModified: '2026-11-17',
    });
  });

  it('describes the site in the manifest, in the default theme sheet color, with the icons', () => {
    const manifest = app.manifest();
    const { site } = app.site.siteData();
    expect(manifest).toEqual({
      name: site.personal.name,
      short_name: site.personal.name.length <= 12 ? site.personal.name : initials(site.personal.name),
      description: site.seo.description,
      start_url: '/',
      display: 'browser',
      background_color: '#0b1f45',
      theme_color: '#0b1f45',
      icons: [
        { src: '/icon', sizes: '32x32', type: 'image/png' },
        { src: '/apple-icon', sizes: '180x180', type: 'image/png' },
      ],
    });
  });

  it('draws the home image and every visible project image as 1200 by 630 PNG files', async () => {
    expect(app.homeImage.size).toEqual({ width: 1200, height: 630 });
    expect(app.homeImage.contentType).toBe('image/png');
    expect(pngSize(new Uint8Array(await (await app.homeImage.default()).arrayBuffer()))).toEqual({ width: 1200, height: 630 });
    for (const { slug } of app.projectImage.generateStaticParams()) {
      const response = await app.projectImage.default({ params: { slug } });
      expect(response.headers.get('content-type'), slug).toBe('image/png');
      expect(pngSize(new Uint8Array(await response.arrayBuffer())), slug).toEqual({ width: 1200, height: 630 });
    }
  }, 120_000);

  it('draws the icon at 32 px, the Apple icon at 180 px, and /favicon.ico as an icon file of three PNG sizes', async () => {
    expect(app.icon.size).toEqual({ width: 32, height: 32 });
    expect(pngSize(new Uint8Array(await (await app.icon.default()).arrayBuffer()))).toEqual({ width: 32, height: 32 });
    expect(app.appleIcon.size).toEqual({ width: 180, height: 180 });
    expect(pngSize(new Uint8Array(await (await app.appleIcon.default()).arrayBuffer()))).toEqual({ width: 180, height: 180 });
    expect(app.favicon.dynamic).toBe('force-static');
    const response = await app.favicon.GET();
    expect(response.headers.get('content-type')).toBe('image/x-icon');
    const ico = new Uint8Array(await response.arrayBuffer());
    const view = new DataView(ico.buffer, ico.byteOffset, ico.byteLength);
    expect([view.getUint16(0, true), view.getUint16(2, true), view.getUint16(4, true)]).toEqual([0, 1, 3]);
    const sizes = [0, 1, 2].map((i) => {
      const entry = 6 + i * 16;
      const offset = view.getUint32(entry + 12, true);
      const length = view.getUint32(entry + 8, true);
      const png = pngSize(ico.subarray(offset, offset + length));
      expect(png.width).toBe(ico[entry]);
      return png.width;
    });
    expect(sizes).toEqual([16, 32, 48]);
  }, 60_000);
});
