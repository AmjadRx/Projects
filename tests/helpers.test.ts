import { describe, expect, it } from 'vitest';
import { loadPublicProjects, loadSite } from '../lib/content';
import { dateSortKey, domainKey, gpaText, isGpaFact, projectDomains, sentenceCase, statText, statusText } from '../lib/format';
import { makeLinkResolver, projectSlugOf } from '../lib/links';
import { mergedLog, newestFirst } from '../lib/log';
import { aspectOf, downloadHrefOf, extensionOf, formatBytes, objectPosition, parseEmbed, typeLabelOf } from '../lib/media';
import { jsonLd } from '../lib/jsonld';
import { socialLinksFor } from '../lib/site';

describe('the GPA helper', () => {
  it('prints the label, a space, and the value', () => {
    expect(gpaText({ gpa: '3.65', gpaLabel: 'Major GPA' })).toBe('Major GPA 3.65');
  });

  it('prints nothing when either part is empty, so the value never appears without its label', () => {
    expect(gpaText({ gpa: '', gpaLabel: 'Major GPA' })).toBe('');
    expect(gpaText({ gpa: '3.65', gpaLabel: '' })).toBe('');
    expect(gpaText({ gpa: '  ', gpaLabel: 'Major GPA' })).toBe('');
  });

  it('recognizes the about fact that repeats the GPA', () => {
    expect(isGpaFact({ label: 'Major GPA' }, { gpaLabel: 'Major GPA' })).toBe(true);
    expect(isGpaFact({ label: 'major gpa ' }, { gpaLabel: 'Major GPA' })).toBe(true);
    expect(isGpaFact({ label: 'Focus' }, { gpaLabel: 'Major GPA' })).toBe(false);
  });

  it('matches the seed: the label is "Major GPA"', () => {
    expect(gpaText(loadSite().personal)).toBe('Major GPA 3.65');
  });
});

describe('status and readouts', () => {
  it('prints the status label, or the status value in sentence case', () => {
    expect(statusText({ status: 'in-progress', statusLabel: 'Stage 1 of 8' })).toBe('Stage 1 of 8');
    expect(statusText({ status: 'in-progress', statusLabel: '' })).toBe('In progress');
    expect(statusText({ status: 'completed' })).toBe('Completed');
    expect(sentenceCase('shipped')).toBe('Shipped');
  });

  it('keeps a readout as one text run with its hedge', () => {
    expect(statText({ prefix: '~', value: '50', suffix: '%' })).toBe('~50%');
    expect(statText({ value: '504', suffix: ' V' })).toBe('504 V');
    expect(statText({ value: '1st' })).toBe('1st');
  });
});

describe('domains', () => {
  it('splits the comma-separated domain and groups without regard to case', () => {
    expect(projectDomains({ domain: 'eVTOL, structures, power' })).toEqual(['eVTOL', 'structures', 'power']);
    expect(domainKey('Power electronics')).toBe(domainKey('power Electronics'));
    expect(domainKey('eVTOL')).toBe('evtol');
  });
});

describe('links', () => {
  const resolve = makeLinkResolver(new Set(['raven']));

  it('keeps links to pages the site renders', () => {
    expect(resolve('/projects/raven')).toEqual({ href: '/projects/raven', external: false });
    expect(resolve('/log')).toEqual({ href: '/log', external: false });
    expect(resolve('/projects/raven#rv-j')?.href).toBe('/projects/raven#rv-j');
    expect(resolve('https://github.com/AmjadRx')).toEqual({ href: 'https://github.com/AmjadRx', external: true });
    expect(resolve('mailto:someone@example.com')?.external).toBe(false);
    expect(resolve('/media/raven/img-7657.jpeg')?.href).toBe('/media/raven/img-7657.jpeg');
  });

  it('drops links to hidden or missing pages and unsafe schemes', () => {
    expect(resolve('/projects/hidden-thing')).toBeNull();
    expect(resolve('/no-such-page')).toBeNull();
    expect(resolve('javascript:alert(1)')).toBeNull();
    expect(resolve('//evil.example/x')).toBeNull();
    expect(resolve('')).toBeNull();
    expect(resolve(undefined)).toBeNull();
  });

  it('reads the project slug of a project path', () => {
    expect(projectSlugOf('/projects/raven#log')).toBe('raven');
    expect(projectSlugOf('/about')).toBeNull();
  });
});

describe('media helpers', () => {
  it('reads file names, extensions, and types', () => {
    expect(extensionOf('/media/raven/img-7657.jpeg')).toBe('jpeg');
    expect(extensionOf('https://x.public.blob.vercel-storage.com/a/b.PDF?download=1')).toBe('pdf');
    expect(typeLabelOf('/dev/samples/model.glb')).toBe('GLB 3D model');
    expect(typeLabelOf('/x/file.xyz')).toBe('XYZ file');
  });

  it('formats sizes in decimal units', () => {
    expect(formatBytes(999)).toBe('999 B');
    expect(formatBytes(1500)).toBe('1.5 kB');
    expect(formatBytes(222688)).toBe('223 kB');
    expect(formatBytes(4419650)).toBe('4.4 MB');
    expect(formatBytes(undefined)).toBe('');
  });

  it('uses the Blob download address for Blob files only', () => {
    expect(downloadHrefOf('/media/a.pdf')).toBe('/media/a.pdf');
    expect(downloadHrefOf('https://abc.public.blob.vercel-storage.com/a.pdf')).toBe('https://abc.public.blob.vercel-storage.com/a.pdf?download=1');
  });

  it('builds embed players only from validated ids on allow-listed hosts', () => {
    expect(parseEmbed('https://www.youtube.com/watch?v=dQw4w9WgXcQ')?.embedUrl).toBe(
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0',
    );
    expect(parseEmbed('https://youtu.be/dQw4w9WgXcQ')?.id).toBe('dQw4w9WgXcQ');
    expect(parseEmbed('https://vimeo.com/123456789')?.embedUrl).toBe('https://player.vimeo.com/video/123456789?dnt=1&autoplay=1');
    expect(parseEmbed('https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(parseEmbed('https://www.youtube.com/watch?v=bad"id')).toBeNull();
    expect(parseEmbed('javascript:alert(1)')).toBeNull();
  });

  it('turns a focal point into an object position and falls back to a default ratio', () => {
    expect(objectPosition({ x: 0.25, y: 0.75 })).toBe('25% 75%');
    expect(objectPosition({ x: 2, y: -1 })).toBe('100% 0%');
    expect(objectPosition(undefined)).toBeUndefined();
    expect(aspectOf({ width: 1600, height: 1000 })).toBeCloseTo(1.6);
    expect(aspectOf({}, 4 / 3)).toBeCloseTo(4 / 3);
  });
});

describe('the build log', () => {
  it('sorts dates of mixed precision newest first and keeps ties in their incoming order', () => {
    const rows = [
      { date: '2026-02', id: 'a' },
      { date: '2026-08-13', id: 'b' },
      { date: '2026-07', id: 'c' },
      { date: '2026-08-13', id: 'd' },
    ];
    expect(newestFirst(rows).map((r) => r.id)).toEqual(['b', 'd', 'c', 'a']);
    expect(dateSortKey('2026-07')).toBe('2026-07-00');
  });

  it('merges the log entries of visible projects only', () => {
    const entries = mergedLog(loadPublicProjects());
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e) => e.project.visible)).toBe(true);
    const hidden = { ...loadPublicProjects()[0], visible: false };
    expect(mergedLog([hidden]).every((e) => e.project === hidden)).toBe(true);
  });
});

describe('social links', () => {
  it('skips mailto links and shows the phone only when personal.phone is set', () => {
    const site = loadSite();
    const contact = socialLinksFor(site, 'contact');
    expect(contact.some((l) => l.url.startsWith('mailto:'))).toBe(false);
    expect(contact.some((l) => l.url.startsWith('tel:'))).toBe(true);
    const noPhone = { ...site, personal: { ...site.personal, phone: '' } };
    expect(socialLinksFor(noPhone, 'contact').some((l) => l.url.startsWith('tel:'))).toBe(false);
  });

  it('puts LinkedIn and GitHub in the nav, and the scheduling link only on the contact page', () => {
    const site = loadSite();
    expect(socialLinksFor(site, 'nav').map((l) => l.label)).toEqual(['LinkedIn', 'GitHub']);
    expect(socialLinksFor(site, 'contact').map((l) => l.label)).toContain('Book a call');
    expect(socialLinksFor(site, 'footer').map((l) => l.label)).not.toContain('Book a call');
  });
});

describe('JSON-LD', () => {
  it('escapes characters that could close the script element', () => {
    const out = jsonLd({ name: '</script><script>alert(1)</script>' });
    expect(out).not.toContain('<');
    expect(JSON.parse(out).name).toBe('</script><script>alert(1)</script>');
  });
});
