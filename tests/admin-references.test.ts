/** The shared reference rules (lib/admin/references.ts), including the cases the review found missing (MEDIA-1). */
import { describe, expect, it } from 'vitest';
import { addressOf, countReferencePaths, mentions, referencePaths, rewriteData } from '../lib/admin/references';

const HOSTS = ['amjadrehawi.com', 'www.amjadrehawi.com'];
const SRC = '/media/raven/report.pdf';

const project = {
  cover: { kind: 'image', src: '/media/raven/cover.webp', alt: '' },
  blocks: [
    { id: 'a', type: 'bullets', items: ['Read the [final report](/media/raven/report.pdf).', 'Nothing here'] },
    { id: 'b', type: 'file', label: 'Report', src: 'https://www.amjadrehawi.com/media/raven/report.pdf' },
    { id: 'c', type: 'linkRow', links: [{ label: 'Report', url: 'https://amjadrehawi.com/media/raven/report.pdf#page=3' }] },
    { id: 'd', type: 'twoCol', left: [{ id: 'e', type: 'bullets', items: ['See (/media/raven/report.pdf)'] }], right: [] },
    { id: 'f', type: 'text', md: 'Not this one: /media/raven/report.pdf2 or /media/raven/report.pdfx' },
  ],
};

describe('references', () => {
  it('find links in bullets items, absolute site addresses, and nested columns', () => {
    expect(referencePaths(project, SRC, HOSTS)).toEqual([
      'blocks[0].items[0]',
      'blocks[1].src',
      'blocks[2].links[0].url',
      'blocks[3].left[0].items[0]',
    ]);
  });

  it('read an absolute address on this site as its path, and leave other hosts alone', () => {
    expect(addressOf('https://www.amjadrehawi.com/media/raven/report.pdf?download=1', HOSTS)).toBe(SRC);
    expect(addressOf('https://example.com/media/raven/report.pdf', HOSTS)).toBe('https://example.com/media/raven/report.pdf');
    expect(mentions('see /media/raven/report.pdf.', SRC)).toBe(true);
    expect(mentions('see /media/raven/report.pdf2', SRC)).toBe(false);
  });

  it('count one per referring field', () => {
    const counts = new Map<string, number>();
    countReferencePaths(project, [SRC, '/media/raven/cover.webp', '/media/raven/unused.webp'], counts, HOSTS);
    expect(counts.get(SRC)).toBe(4);
    expect(counts.get('/media/raven/cover.webp')).toBe(1);
    expect(counts.get('/media/raven/unused.webp') ?? 0).toBe(0);
  });

  it('rewrite every reference, keeping hosts, queries, and fragments, and keep untouched objects', () => {
    const { data, count } = rewriteData(project, SRC, '/media/raven/final.pdf', HOSTS);
    expect(count).toBe(4);
    expect(data.blocks[0]).toMatchObject({ items: ['Read the [final report](/media/raven/final.pdf).', 'Nothing here'] });
    expect(data.blocks[1]).toMatchObject({ src: 'https://www.amjadrehawi.com/media/raven/final.pdf' });
    expect(data.blocks[2]).toMatchObject({ links: [{ url: 'https://amjadrehawi.com/media/raven/final.pdf#page=3' }] });
    expect(data.cover).toBe(project.cover);
    expect(data.blocks[4]).toBe(project.blocks[4]);
    // A move to Blob replaces an own-host absolute address whole, never leaving the host in front.
    const blob = 'https://abc123.public.blob.vercel-storage.com/media/raven/report-x1.pdf';
    const toBlob = rewriteData(project, SRC, blob, HOSTS);
    expect(toBlob.data.blocks[1]).toMatchObject({ src: blob });
    expect(toBlob.data.blocks[2]).toMatchObject({ links: [{ url: `${blob}#page=3` }] });
    expect(toBlob.data.blocks[0]).toMatchObject({ items: [`Read the [final report](${blob}).`, 'Nothing here'] });
    const none = rewriteData(project, '/media/raven/absent.pdf', '/media/raven/x.pdf', HOSTS);
    expect(none.count).toBe(0);
    expect(none.data).toBe(project);
  });
});
