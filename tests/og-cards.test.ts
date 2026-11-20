/**
 * What the Open Graph images show and how the pages name them (lib/og/cards.ts, lib/meta.tsx): the
 * cards keep only fields with text, the alt text reads the card in order with the title block's
 * own labels, an image's address changes whenever what it draws changes, the icon's initials, and
 * the share fields of a page's metadata. Built on small made-up records, never the seed.
 */
import { describe, expect, it } from 'vitest';
import { cardAlt, cardVersion, homeCard, initials, projectCard, type ProjectCard } from '../lib/og/cards';
import { pageMetadata, shareImage } from '../lib/meta';
import type { Project, Site } from '../lib/types';

function project(overrides: Partial<Project> = {}): Project {
  return {
    slug: 'test-rig',
    visible: true,
    title: 'Test Rig',
    subtitle: 'A bench for the tests',
    role: 'Builder',
    timeframe: 'Jan 2026 to present',
    status: 'in-progress',
    statusLabel: 'On the bench',
    maturity: { step: 2, label: 'In design' },
    featured: false,
    order: 1,
    domain: 'Tests',
    tags: [],
    cover: { kind: 'image', src: '', alt: '' },
    links: [],
    callouts: [],
    pitch: 'A pitch.',
    highlights: [],
    blocks: [],
    ...overrides,
  } as Project;
}

const personal = (overrides: Partial<Site['personal']> = {}) =>
  ({ name: 'Ada Example', tagline: 'Builder of test rigs.', ...overrides }) as Site['personal'];

describe('the cards', () => {
  it('the home card: the headline (the tagline, or the name without one) and the name', () => {
    expect(homeCard({ personal: personal() })).toEqual({ kind: 'home', headline: 'Builder of test rigs.', name: 'Ada Example' });
    expect(homeCard({ personal: personal({ tagline: '  ' }) })).toEqual({ kind: 'home', headline: 'Ada Example', name: 'Ada Example' });
    expect(homeCard({ personal: personal({ tagline: '', name: '' }) })).toEqual({ kind: 'home' });
  });

  it('a project card: the title block fields with text, the status falling back to its value', () => {
    expect(projectCard(project(), 3, 9, '2026-11-01')).toEqual({
      kind: 'project',
      title: 'Test Rig',
      subtitle: 'A bench for the tests',
      sheet: 3,
      sheets: 9,
      role: 'Builder',
      dates: 'Jan 2026 to present',
      status: 'On the bench',
      rev: '2026-11-01',
      maturity: { step: 2, label: 'In design' },
    });
    const bare = projectCard(project({ subtitle: ' ', role: '', timeframe: '', statusLabel: '', maturity: undefined }), 1, 1);
    expect(bare).toEqual({ kind: 'project', title: 'Test Rig', sheet: 1, sheets: 1, status: 'In progress' });
  });

  it('keeps the maturity step on the five-step scale', () => {
    expect(projectCard(project({ maturity: { step: 9 as 5, label: 'x' } }), 1, 1).maturity?.step).toBe(5);
  });
});

describe('the alt text', () => {
  it('reads the home image: the headline, then the name in its title block', () => {
    expect(cardAlt(homeCard({ personal: personal() }))).toBe('Builder of test rigs. Name: Ada Example.');
    expect(cardAlt(homeCard({ personal: personal({ tagline: '' }) }))).toBe('Name: Ada Example.');
  });

  it('reads a project image in drawing order with the title block labels, and only fields with text', () => {
    expect(cardAlt(projectCard(project(), 3, 9, '2026-11-01'))).toBe(
      'Test Rig. A bench for the tests. Sheet 3 of 9. Role: Builder. Dates: Jan 2026 to present. Status: On the bench. Rev 2026-11-01. Maturity: In design.',
    );
    expect(cardAlt(projectCard(project({ subtitle: '', role: '', timeframe: '', maturity: undefined }), 1, 1))).toBe(
      'Test Rig. Sheet 1 of 1. Status: On the bench.',
    );
  });

  it('never doubles a full stop', () => {
    const alt = cardAlt(projectCard(project({ title: 'Done.', subtitle: 'Really?' }), 1, 1));
    expect(alt.startsWith('Done. Really? Sheet 1 of 1.')).toBe(true);
    expect(alt).not.toMatch(/\.\./);
  });
});

describe('the image address version', () => {
  it('changes with what the image draws and nothing else', () => {
    const card: ProjectCard = projectCard(project(), 1, 2);
    const palette = { sheet: '#000' };
    expect(cardVersion(card, palette)).toMatch(/^[0-9a-f]{10}$/);
    expect(cardVersion(card, palette)).toBe(cardVersion(projectCard(project(), 1, 2), { sheet: '#000' }));
    expect(cardVersion(card, palette)).not.toBe(cardVersion(projectCard(project({ title: 'Test Rig 2' }), 1, 2), palette));
    expect(cardVersion(card, palette)).not.toBe(cardVersion(projectCard(project(), 1, 3), palette));
    expect(cardVersion(card, palette)).not.toBe(cardVersion(card, { sheet: '#111' }));
  });
});

describe('the icon initials', () => {
  it('takes the first letters of the first and last words, in capitals', () => {
    expect(initials('Amjad Rehawi')).toBe('AR');
    expect(initials('ada  b. example')).toBe('AE');
    expect(initials('Ada')).toBe('A');
    expect(initials('  ')).toBe('');
  });
});

describe('the share fields of a page', () => {
  const site = { personal: personal(), seo: { title: 'Site title', description: 'Site description' } } as Site;
  const image = { url: '/opengraph-image?v=abc', width: 1200, height: 630, alt: 'An alt.', type: 'image/png' };

  it('keeps a site path relative, for Next to resolve against the deployment, with its size, type, and alt', () => {
    expect(shareImage(image)).toEqual({ og: image, twitter: { url: image.url, alt: 'An alt.' } });
    expect(shareImage({ url: 'https://example.com/a.png', alt: ' ' })).toEqual({ og: { url: 'https://example.com/a.png' }, twitter: { url: 'https://example.com/a.png' } });
    expect(shareImage({ url: '' })).toBeUndefined();
    expect(shareImage(undefined)).toBeUndefined();
  });

  it('gives a page its title, description, canonical address, and a large-image card with its image', () => {
    const meta = pageMetadata(site, { title: 'About', description: 'About text', path: '/about', image });
    expect(meta).toEqual({
      title: 'About',
      description: 'About text',
      alternates: { canonical: '/about' },
      openGraph: { type: 'website', siteName: 'Ada Example', title: 'About · Ada Example', description: 'About text', url: '/about', images: [image] },
      twitter: { card: 'summary_large_image', title: 'About · Ada Example', description: 'About text', images: [{ url: image.url, alt: 'An alt.' }] },
    });
  });

  it('leaves out an empty description, and falls back to the small card with no image', () => {
    const meta = pageMetadata(site, { description: ' ', path: '/' });
    expect(meta).not.toHaveProperty('description');
    expect(meta.openGraph).not.toHaveProperty('description');
    expect(meta.openGraph).toMatchObject({ title: 'Site title' });
    expect(meta.twitter).toEqual({ card: 'summary', title: 'Site title' });
  });
});
