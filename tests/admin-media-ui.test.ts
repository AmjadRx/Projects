/**
 * The media library's rules (components/admin/media/logic.ts): which store each prepared part
 * goes to at the size limits, the MediaRef an upload or a library file becomes, the "not used
 * anywhere" filter, reference counting and rewriting in the working copy, "keep both" names,
 * and the content-check requests for a file's words. Logic only; no DOM, no network.
 */
import { describe, expect, it } from 'vitest';
import { MAX_CHECK_ITEMS, MAX_CHECK_TEXT_BYTES, MAX_REPO_UPLOAD_BODY_BYTES, type MediaItem } from '../lib/admin/contract';
import type { PreparedPart, PreparedUpload } from '../lib/admin/convert/types';
import { STORAGE_MESSAGES } from '../lib/storage/labels';
import { BLOB_MAX_BYTES, REPO_MAX_BYTES } from '../lib/storage/rules';
import type { Project, Site } from '../lib/types';
import { uploadBodySize } from '../components/admin/state/api';
import type { Doc } from '../components/admin/state/store';
import {
  ACCEPT_ANY,
  ACCEPT_CAPTIONS,
  acceptAttribute,
  acceptRefusal,
  BLOB_NOT_CONFIGURED,
  checkBodies,
  checkItemsFor,
  chunkText,
  clearedRef,
  countLocalReferences,
  findLocalReferences,
  findPosterItem,
  folderOfAddress,
  freeName,
  freeNames,
  givenName,
  isResumeName,
  isUnused,
  kindOfName,
  mediaRefFromItem,
  mediaRefFromUpload,
  planStorage,
  projectMediaFolder,
  refExtrasIndex,
  replaceInDoc,
  replaceRefusal,
  RESUME_QUESTION,
  resumeWarning,
  uniqueFindings,
  unusedFiles,
} from '../components/admin/media/logic';
import { folderExists } from '../components/admin/media/services';
import { followPath } from '../components/admin/media/targets';

/** A stand-in Blob with only a size: planStorage and uploadBodySize read nothing else. */
function sized(size: number): Blob {
  return { size } as unknown as Blob;
}

function part(role: PreparedPart['role'], name: string, size: number, contentType = 'application/octet-stream'): PreparedPart {
  return { role, name, blob: sized(size), contentType };
}

function item(name: string, extra: Partial<MediaItem> = {}): MediaItem {
  const src = `/media/test/${name}`;
  return { store: 'repo', folder: 'test', name, src, previewSrc: `/api/upload/file?src=${encodeURIComponent(src)}`, downloadHref: src, ...extra };
}

// ---------------------------------------------------------------------------------------------
// Which store each part goes to
// ---------------------------------------------------------------------------------------------

describe('planStorage: repository, Blob, or refused', () => {
  it('sends a main file of exactly 4,000,000 bytes to the repository', () => {
    const decision = planStorage([part('main', 'photo.webp', REPO_MAX_BYTES)], { blobConfigured: false });
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.plan.blob).toBeNull();
    expect(decision.plan.repo.map((chunk) => chunk.map((p) => p.name))).toEqual([['photo.webp']]);
  });

  it('sends one byte more to Vercel Blob when it is configured', () => {
    const main = part('main', 'clip.mp4', REPO_MAX_BYTES + 1, 'video/mp4');
    const decision = planStorage([main], { blobConfigured: true });
    expect(decision).toEqual({ ok: true, plan: { blob: main, repo: [] } });
  });

  it('refuses one byte more while Blob is not configured, with the message that says how to connect it', () => {
    const decision = planStorage([part('main', 'clip.mp4', REPO_MAX_BYTES + 1, 'video/mp4')], { blobConfigured: false });
    expect(decision).toEqual({ ok: false, message: BLOB_NOT_CONFIGURED });
    expect(BLOB_NOT_CONFIGURED).toBe(
      'Files over 4 MB need Vercel Blob. Connect a Blob store to this environment in Vercel (Storage), which sets BLOB_READ_WRITE_TOKEN.',
    );
  });

  it('leaves the decision to the server when the Blob status is not known', () => {
    const main = part('main', 'clip.mp4', REPO_MAX_BYTES + 1, 'video/mp4');
    const decision = planStorage([main], { blobConfigured: null });
    expect(decision.ok && decision.plan.blob).toBe(main);
  });

  it('takes up to 500 MB in Blob and refuses one byte more', () => {
    expect(planStorage([part('main', 'long.mp4', BLOB_MAX_BYTES)], { blobConfigured: true }).ok).toBe(true);
    expect(planStorage([part('main', 'long.mp4', BLOB_MAX_BYTES + 1)], { blobConfigured: true })).toEqual({
      ok: false,
      message: STORAGE_MESSAGES.tooLarge(BLOB_MAX_BYTES),
    });
  });

  it('sends a small main file and its poster in one request, so one commit', () => {
    const main = part('main', 'clip.mp4', 3_000_000);
    const poster = part('poster', 'clip-poster.webp', 1_000_000);
    expect(uploadBodySize([main, poster])).toBeLessThanOrEqual(MAX_REPO_UPLOAD_BODY_BYTES);
    const decision = planStorage([main, poster], { blobConfigured: false });
    expect(decision.ok && decision.plan.repo).toEqual([[main, poster]]);
  });

  it('splits the main file and its poster into two requests when together they pass the body limit', () => {
    const main = part('main', 'clip.mp4', REPO_MAX_BYTES);
    const poster = part('poster', 'clip-poster.webp', 500_000);
    expect(uploadBodySize([main, poster])).toBeGreaterThan(MAX_REPO_UPLOAD_BODY_BYTES);
    const decision = planStorage([main, poster], { blobConfigured: true });
    expect(decision.ok && decision.plan).toEqual({ blob: null, repo: [[main], [poster]] });
  });

  it('puts a large main file in Blob and its poster in the repository', () => {
    const main = part('main', 'model.glb', 12_000_000, 'model/gltf-binary');
    const poster = part('poster', 'model-poster.webp', 40_000, 'image/webp');
    const decision = planStorage([main, poster], { blobConfigured: true });
    expect(decision.ok && decision.plan).toEqual({ blob: main, repo: [[poster]] });
  });

  it('refuses a repository-only type (SVG) over the line, Blob or not', () => {
    const decision = planStorage([part('main', 'drawing.svg', REPO_MAX_BYTES + 1, 'image/svg+xml')], { blobConfigured: true });
    expect(decision).toEqual({ ok: false, message: STORAGE_MESSAGES.repoOnlyTooLarge('svg', REPO_MAX_BYTES) });
  });

  it('refuses an empty file and an upload without a main file', () => {
    expect(planStorage([part('main', 'empty.pdf', 0)], { blobConfigured: true })).toEqual({ ok: false, message: STORAGE_MESSAGES.emptyFile });
    expect(planStorage([part('poster', 'x-poster.webp', 10)], { blobConfigured: true }).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// MediaRefs
// ---------------------------------------------------------------------------------------------

function prepared(mediaKind: PreparedUpload['mediaKind'], meta: PreparedUpload['meta'] = {}): Pick<PreparedUpload, 'mediaKind' | 'meta'> {
  return { mediaKind, meta };
}

describe('mediaRefFromUpload', () => {
  it('builds a photo MediaRef with empty alt text and its store, in the schema order', () => {
    const ref = mediaRefFromUpload(prepared('image', { width: 2560, height: 1440 }), { main: { src: '/media/raven/a.webp', store: 'repo' } });
    expect(ref).toEqual({ kind: 'image', src: '/media/raven/a.webp', alt: '', store: 'repo' });
    expect(JSON.stringify(ref)).toBe('{"kind":"image","src":"/media/raven/a.webp","alt":"","store":"repo"}');
  });

  it('records the poster of a video and the Blob store of a large file', () => {
    const ref = mediaRefFromUpload(prepared('video', { durationSec: 12 }), {
      main: { src: 'https://abc.public.blob.vercel-storage.com/media/raven/clip-0123456789ab.mp4', store: 'blob' },
      poster: { src: '/media/raven/clip-poster.webp' },
    });
    expect(ref).toEqual({
      kind: 'video',
      src: 'https://abc.public.blob.vercel-storage.com/media/raven/clip-0123456789ab.mp4',
      alt: '',
      poster: '/media/raven/clip-poster.webp',
      store: 'blob',
    });
  });

  it('keeps the waveform of audio only, clamped to 0 to 1 and at most 4096 peaks', () => {
    const peaks = [0, 0.5, 1, 1.4, -0.2, Number.NaN];
    expect(mediaRefFromUpload(prepared('audio', { waveform: peaks }), { main: { src: '/media/site/a.m4a', store: 'repo' } })?.waveform).toEqual([0, 0.5, 1, 1, 0, 0]);
    expect(mediaRefFromUpload(prepared('audio', { waveform: new Array(5000).fill(0.5) }), { main: { src: '/media/site/a.m4a', store: 'repo' } })?.waveform).toHaveLength(4096);
    expect(mediaRefFromUpload(prepared('video', { waveform: [0.5] }), { main: { src: '/media/site/v.mp4', store: 'repo' } })).not.toHaveProperty('waveform');
    expect(mediaRefFromUpload(prepared('audio'), { main: { src: '/media/site/a.mp3', store: 'repo' } })).not.toHaveProperty('waveform');
  });

  it('gives no MediaRef for captions, office files, and other downloads', () => {
    expect(mediaRefFromUpload(prepared(null, { text: 'WEBVTT' }), { main: { src: '/media/raven/clip.vtt', store: 'repo' } })).toBeNull();
  });

  it('does not share the waveform array with the prepared upload', () => {
    const waveform = [0.25, 0.75];
    const ref = mediaRefFromUpload(prepared('audio', { waveform }), { main: { src: '/media/site/a.m4a', store: 'repo' } });
    waveform[0] = 1;
    expect(ref?.waveform).toEqual([0.25, 0.75]);
  });
});

describe('mediaRefFromItem and clearedRef', () => {
  it('takes the kind from the name and the extras a file already carries', () => {
    expect(mediaRefFromItem(item('clip.mp4'), { poster: '/media/test/clip-poster.webp', captions: '/media/test/clip.vtt' })).toEqual({
      kind: 'video',
      src: '/media/test/clip.mp4',
      alt: '',
      poster: '/media/test/clip-poster.webp',
      captions: '/media/test/clip.vtt',
      store: 'repo',
    });
    expect(mediaRefFromItem(item('photo.webp'), { poster: '/media/test/other.webp' })).toEqual({ kind: 'image', src: '/media/test/photo.webp', alt: '', store: 'repo' });
    expect(mediaRefFromItem(item('drawing.svg'))?.kind).toBe('image');
    expect(mediaRefFromItem(item('tone.mp3'), { waveform: [0.1, 0.9] })?.waveform).toEqual([0.1, 0.9]);
    expect(mediaRefFromItem(item('model.glb'))?.kind).toBe('model');
    expect(mediaRefFromItem(item('report.pdf'))?.kind).toBe('document');
  });

  it('gives no MediaRef for captions and plain files', () => {
    expect(mediaRefFromItem(item('clip.vtt'))).toBeNull();
    expect(mediaRefFromItem(item('data.csv'))).toBeNull();
  });

  it('clears to the seed\'s empty shape, keeping the kind (D-07)', () => {
    expect(clearedRef({ kind: 'video' })).toEqual({ kind: 'video', src: '', alt: '' });
  });
});

// ---------------------------------------------------------------------------------------------
// Kinds and what a target takes
// ---------------------------------------------------------------------------------------------

describe('kinds and accept', () => {
  it('reads the kind of a stored file from its name', () => {
    expect(['a.webp', 'b.svg', 'c.mp4', 'd.glb', 'e.pdf', 'f.docx', 'g.m4a', 'h.vtt', 'i.zip', 'j.xlsx', 'k.unknown'].map(kindOfName)).toEqual([
      'image',
      'image',
      'video',
      'model',
      'document',
      'document',
      'audio',
      'captions',
      'file',
      'file',
      'file',
    ]);
  });

  it('refuses a prepared file the field does not take, before anything is stored', () => {
    const accept = { type: 'media' as const, kinds: ['image', 'video'] as const };
    expect(acceptRefusal(accept, { kind: 'image', mediaKind: 'image' })).toBeNull();
    expect(acceptRefusal(accept, { kind: 'document', mediaKind: 'document' })).toBe(
      'This field takes images and videos, and this file is a document. Add it in the media library instead.',
    );
    expect(acceptRefusal(ACCEPT_CAPTIONS, { kind: 'captions', mediaKind: null })).toBeNull();
    expect(acceptRefusal(ACCEPT_CAPTIONS, { kind: 'file', mediaKind: null })).toMatch(/WebVTT/);
    expect(acceptRefusal(ACCEPT_ANY, { kind: 'office', mediaKind: null })).toBeNull();
  });

  it('lets a file be replaced only by the same kind', () => {
    expect(replaceRefusal(item('clip.mp4'), { kind: 'video', mediaKind: 'video' })).toBeNull();
    expect(replaceRefusal(item('report.pdf'), { kind: 'document', mediaKind: 'document' })).toBeNull();
    expect(replaceRefusal(item('clip.mp4'), { kind: 'image', mediaKind: 'image' })).toMatch(/same kind/);
  });

  it('builds the file input accept list, with model companions, and none for plain files', () => {
    expect(acceptAttribute(['image'])).toContain('.heic');
    expect(acceptAttribute(['model'])).toContain('.bin');
    expect(acceptAttribute(['model'])).toContain('.step');
    expect(acceptAttribute(['captions'])).toBe('.vtt');
    expect(acceptAttribute(['image', 'file'])).toBe('');
  });
});

// ---------------------------------------------------------------------------------------------
// The working copy: references, the "not used anywhere" filter, rewriting
// ---------------------------------------------------------------------------------------------

function doc(): Doc {
  const site = {
    settings: { heroModel: { src: '/media/site/hero.glb', alt: '' } },
    personal: { headshot: { kind: 'image', src: '/media/site/head.webp', alt: 'A photo' } },
    about: { paragraphs: ['See [the report](/media/site/report.pdf#page=2) for details.'] },
  } as unknown as Site;
  const project = {
    slug: 'test',
    order: 1,
    cover: { kind: 'video', src: '/media/test/clip.mp4', alt: '', poster: '/media/test/clip-poster.webp', store: 'repo' },
    blocks: [
      { id: 'b1', type: 'file', label: 'Data', src: '/media/test/data.csv?download=1' },
      { id: 'b2', type: 'text', md: 'A photo: ![x](/media/test/photo.webp). Not /media/test/photo.webp2.' },
      { id: 'b3', type: 'audio', media: { kind: 'audio', src: '/media/test/tone.mp3', alt: '', waveform: [0.2, 0.4] } },
    ],
  } as unknown as Project;
  return { site, projects: [{ key: 'content/projects/test.json', loadedFile: 'content/projects/test.json', data: project }] };
}

describe('references in the working copy', () => {
  it('counts whole addresses, addresses with a query or a fragment, and mentions in Markdown fields', () => {
    const counts = countLocalReferences(doc(), [
      '/media/test/clip.mp4',
      '/media/test/clip-poster.webp',
      '/media/test/data.csv',
      '/media/test/photo.webp',
      '/media/site/report.pdf',
      '/media/site/hero.glb',
      '/media/test/unused.webp',
    ]);
    expect(Object.fromEntries(counts)).toEqual({
      '/media/test/clip.mp4': 1,
      '/media/test/clip-poster.webp': 1,
      '/media/test/data.csv': 1,
      '/media/test/photo.webp': 1,
      '/media/site/report.pdf': 1,
      '/media/site/hero.glb': 1,
      '/media/test/unused.webp': 0,
    });
  });

  it('names the file and the field of each reference', () => {
    expect(findLocalReferences(doc(), '/media/test/clip.mp4')).toEqual([{ file: 'content/projects/test.json', path: 'cover.src' }]);
    expect(findLocalReferences(doc(), '/media/site/report.pdf')).toEqual([{ file: 'content/site.json', path: 'about.paragraphs[0]' }]);
    // An address that only starts another file's name is not a reference to it.
    expect(findLocalReferences(doc(), '/media/test/photo.web')).toEqual([]);
    expect(findLocalReferences(doc(), '/media/test/clip')).toEqual([]);
  });

  it('collects the poster, waveform, and captions each file already carries', () => {
    const index = refExtrasIndex(doc());
    expect(index.get('/media/test/clip.mp4')).toEqual({ poster: '/media/test/clip-poster.webp' });
    expect(index.get('/media/test/tone.mp3')).toEqual({ waveform: [0.2, 0.4] });
    expect(index.has('/media/site/hero.glb')).toBe(true);
  });
});

describe('the "not used anywhere" filter', () => {
  it('keeps only files that no draft, published, or editor field uses', () => {
    expect(isUnused({ refs: { draft: 0, live: 0 } })).toBe(true);
    expect(isUnused({ refs: { draft: 1, live: 0 } })).toBe(false);
    expect(isUnused({ refs: { draft: 0, live: 1 } })).toBe(false);
    expect(isUnused({ refs: { draft: 0, live: 0 } }, 1)).toBe(false);
    expect(isUnused({})).toBe(false);
  });

  it('finds Blob files left after a discard and leaves out what the editor uses', () => {
    const blobLeft = item('clip-0123456789ab.mp4', { store: 'blob', src: 'https://abc.public.blob.vercel-storage.com/media/test/clip-0123456789ab.mp4', refs: { draft: 0, live: 0 } });
    const usedInEditor = item('photo.webp', { refs: { draft: 0, live: 0 } });
    const published = item('old.webp', { refs: { draft: 0, live: 2 } });
    const unknown = item('mystery.webp');
    const files = [blobLeft, usedInEditor, published, unknown];
    const local = countLocalReferences(doc(), files.map((file) => file.src));
    expect(unusedFiles(files, local).map((file) => file.name)).toEqual(['clip-0123456789ab.mp4']);
  });
});

describe('replaceInDoc', () => {
  it('returns the same Doc when nothing refers to the file', () => {
    const before = doc();
    expect(replaceInDoc(before, '/media/test/nothing.webp', { src: '/media/test/x.webp' })).toBe(before);
  });

  it('points a MediaRef at a new file: address, store, and poster (Replace)', () => {
    const before = doc();
    const after = replaceInDoc(before, '/media/test/clip.mp4', {
      src: 'https://abc.public.blob.vercel-storage.com/media/test/clip-ffffffffffff.mp4',
      store: 'blob',
      poster: '/media/test/clip-2-poster.webp',
      waveform: null,
    });
    expect(after).not.toBe(before);
    expect(after.site).toBe(before.site);
    expect(after.projects[0].data.cover).toEqual({
      kind: 'video',
      src: 'https://abc.public.blob.vercel-storage.com/media/test/clip-ffffffffffff.mp4',
      alt: '',
      poster: '/media/test/clip-2-poster.webp',
      store: 'blob',
    });
    expect(after.projects[0].data.blocks).toBe(before.projects[0].data.blocks);
  });

  it('drops an old poster when the new file has none, and keeps it on a rename', () => {
    const replaced = replaceInDoc(doc(), '/media/test/clip.mp4', { src: '/media/test/new.mp4', store: 'repo', poster: null });
    expect(replaced.projects[0].data.cover).toEqual({ kind: 'video', src: '/media/test/new.mp4', alt: '', store: 'repo' });
    const renamed = replaceInDoc(doc(), '/media/test/clip.mp4', { src: '/media/test/renamed.mp4' });
    expect(renamed.projects[0].data.cover).toEqual({ kind: 'video', src: '/media/test/renamed.mp4', alt: '', poster: '/media/test/clip-poster.webp', store: 'repo' });
  });

  it('rewrites a file block address with its query, a Markdown mention, and the seed hero model without a kind', () => {
    const csv = replaceInDoc(doc(), '/media/test/data.csv', { src: '/media/test/data-2.csv' });
    expect((csv.projects[0].data.blocks[0] as { src: string }).src).toBe('/media/test/data-2.csv?download=1');
    const md = replaceInDoc(doc(), '/media/test/photo.webp', { src: '/media/test/photo-2.webp' });
    expect((md.projects[0].data.blocks[1] as { md: string }).md).toBe('A photo: ![x](/media/test/photo-2.webp). Not /media/test/photo.webp2.');
    const hero = replaceInDoc(doc(), '/media/site/hero.glb', { src: '/media/site/hero-2.glb', store: 'repo', poster: '/media/site/hero-2-poster.webp' });
    expect((hero.site as unknown as { settings: { heroModel: unknown } }).settings.heroModel).toEqual({
      src: '/media/site/hero-2.glb',
      alt: '',
      poster: '/media/site/hero-2-poster.webp',
    });
  });

  it('replaces the waveform of an audio file', () => {
    const after = replaceInDoc(doc(), '/media/test/tone.mp3', { src: '/media/test/tone-2.m4a', store: 'repo', waveform: [0.9], poster: null });
    expect((after.projects[0].data.blocks[2] as { media: unknown }).media).toEqual({ kind: 'audio', src: '/media/test/tone-2.m4a', alt: '', waveform: [0.9] });
  });
});

// ---------------------------------------------------------------------------------------------
// MEDIA-1: the working copy is searched by the server's rules (lib/admin/references.ts)
// ---------------------------------------------------------------------------------------------

const HOSTS = ['amjadrehawi.com', 'www.amjadrehawi.com'];
const REPORT = '/media/raven/report.pdf';

/** A project that links one file from a bullet, a nested bullet, and absolute addresses on this site's host. */
function linkedDoc(): Doc {
  const project = {
    slug: 'raven',
    order: 1,
    cover: { kind: 'image', src: 'https://amjadrehawi.com/media/raven/cover.webp', alt: 'Cover', store: 'repo' },
    blocks: [
      { id: 'rv-a', type: 'bullets', items: ['Read the [final report](/media/raven/report.pdf).', 'Nothing here'] },
      { id: 'rv-b', type: 'file', label: 'Report', src: 'https://www.amjadrehawi.com/media/raven/report.pdf' },
      { id: 'rv-c', type: 'linkRow', links: [{ label: 'Report', url: 'https://amjadrehawi.com/media/raven/report.pdf#page=3' }] },
      { id: 'rv-d', type: 'twoCol', left: [{ id: 'rv-e', type: 'bullets', items: ['See [it](/media/raven/report.pdf)'] }], right: [] },
      { id: 'rv-f', type: 'text', md: 'Not this one: /media/raven/report.pdf2' },
    ],
  } as unknown as Project;
  const site = { about: { paragraphs: ['Nothing about it.'] } } as unknown as Site;
  return { site, projects: [{ key: 'content/projects/raven.json', loadedFile: 'content/projects/raven.json', data: project }] };
}

describe('references the site renders (MEDIA-1)', () => {
  it('are found in bullets, nested columns, and absolute addresses on this site, as on the server', () => {
    expect(findLocalReferences(linkedDoc(), REPORT, HOSTS)).toEqual([
      { file: 'content/projects/raven.json', path: 'blocks[0].items[0]' },
      { file: 'content/projects/raven.json', path: 'blocks[1].src' },
      { file: 'content/projects/raven.json', path: 'blocks[2].links[0].url' },
      { file: 'content/projects/raven.json', path: 'blocks[3].left[0].items[0]' },
    ]);
    // The library's count, so the file is never offered as "Not used anywhere".
    const counts = countLocalReferences(linkedDoc(), [REPORT, '/media/raven/cover.webp', '/media/raven/unused.pdf'], HOSTS);
    expect(Object.fromEntries(counts)).toEqual({ [REPORT]: 4, '/media/raven/cover.webp': 1, '/media/raven/unused.pdf': 0 });
    expect(isUnused({ refs: { draft: 0, live: 0 } }, counts.get(REPORT))).toBe(false);
  });

  it('use the host the deployment names (NEXT_PUBLIC_SITE_URL) when no hosts are given', () => {
    const before = process.env.NEXT_PUBLIC_SITE_URL;
    process.env.NEXT_PUBLIC_SITE_URL = 'https://www.amjadrehawi.com';
    try {
      expect(countLocalReferences(linkedDoc(), [REPORT]).get(REPORT)).toBe(4);
      expect(findLocalReferences(linkedDoc(), REPORT)).toHaveLength(4);
      const cover = replaceInDoc(linkedDoc(), '/media/raven/cover.webp', { src: '/media/raven/cover-2.webp', store: 'repo', poster: null });
      expect(cover.projects[0].data.cover).toEqual({ kind: 'image', src: 'https://amjadrehawi.com/media/raven/cover-2.webp', alt: 'Cover', store: 'repo' });
    } finally {
      if (before === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
      else process.env.NEXT_PUBLIC_SITE_URL = before;
    }
  });

  it('are all rewritten by a rename, each keeping its host, query, and fragment', () => {
    const before = linkedDoc();
    const after = replaceInDoc(before, REPORT, { src: '/media/raven/final.pdf' }, HOSTS);
    const blocks = after.projects[0].data.blocks as unknown as Record<string, unknown>[];
    expect(blocks[0].items).toEqual(['Read the [final report](/media/raven/final.pdf).', 'Nothing here']);
    expect(blocks[1].src).toBe('https://www.amjadrehawi.com/media/raven/final.pdf');
    expect(blocks[2].links).toEqual([{ label: 'Report', url: 'https://amjadrehawi.com/media/raven/final.pdf#page=3' }]);
    expect((blocks[3].left as Record<string, unknown>[])[0].items).toEqual(['See [it](/media/raven/final.pdf)']);
    expect(blocks[4]).toBe(before.projects[0].data.blocks[4]);
    expect(findLocalReferences(after, REPORT, HOSTS)).toEqual([]);
  });

  it('point at a Blob address after a Replace, without this site\'s host in front of it', () => {
    const blob = 'https://abc.public.blob.vercel-storage.com/media/raven/report-0123456789ab.pdf';
    const after = replaceInDoc(linkedDoc(), REPORT, { src: blob, store: 'blob' }, HOSTS);
    const blocks = after.projects[0].data.blocks as unknown as Record<string, unknown>[];
    expect(blocks[0].items).toEqual([`Read the [final report](${blob}).`, 'Nothing here']);
    expect(blocks[1].src).toBe(blob);
    expect(blocks[2].links).toEqual([{ label: 'Report', url: `${blob}#page=3` }]);
    // A MediaRef whose address is on this site's host takes the new file and its store.
    const newCover = 'https://abc.public.blob.vercel-storage.com/media/raven/cover-0123456789ab.webp';
    const cover = replaceInDoc(linkedDoc(), '/media/raven/cover.webp', { src: newCover, store: 'blob', poster: null }, HOSTS);
    expect(cover.projects[0].data.cover).toEqual({ kind: 'image', src: newCover, alt: 'Cover', store: 'blob' });
  });

  it('give the extras of a MediaRef whose address is on this site\'s host', () => {
    expect(refExtrasIndex(linkedDoc(), HOSTS).has('/media/raven/cover.webp')).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// CLIENT-5: a project's media folder is where its files are
// ---------------------------------------------------------------------------------------------

describe('a project\'s media folder', () => {
  it('is read from a site path, an address on this site, and a Blob address', () => {
    expect(folderOfAddress('/media/raven/a.webp', HOSTS)).toBe('raven');
    expect(folderOfAddress('https://www.amjadrehawi.com/media/raven/a.webp?x=1', HOSTS)).toBe('raven');
    expect(folderOfAddress('https://abc.public.blob.vercel-storage.com/media/raven-evtol/clip-0123456789ab.mp4', HOSTS)).toBe('raven-evtol');
    expect(folderOfAddress('https://example.com/media/raven/a.webp', HOSTS)).toBeNull();
    expect(folderOfAddress('/media/Bad Folder/a.webp', HOSTS)).toBeNull();
    expect(folderOfAddress('/projects/raven', HOSTS)).toBeNull();
  });

  it('is the folder most of its media addresses point into, not its slug, so a rename keeps it', () => {
    const renamed = {
      slug: 'raven-evtol',
      cover: { kind: 'image', src: '/media/raven/cover.webp' },
      blocks: [
        { id: 'rv-a', type: 'text', md: 'See [the report](/media/raven/report.pdf) and ![x](/media/site/logo.webp).' },
        { id: 'rv-b', type: 'image', media: { kind: 'image', src: '/media/raven-evtol/new.webp' } },
      ],
    };
    expect(projectMediaFolder(renamed, 'raven-evtol', HOSTS)).toBe('raven');
  });

  it('is the saved slug for a project with no media, and wins a tie', () => {
    expect(projectMediaFolder({ slug: 'fresh', blocks: [] }, 'fresh', HOSTS)).toBe('fresh');
    const tied = { cover: { kind: 'image', src: '/media/raven/a.webp' }, blocks: [{ id: 'x', type: 'file', label: '', src: '/media/copy/b.pdf' }] };
    expect(projectMediaFolder(tied, 'copy', HOSTS)).toBe('copy');
    // The site's folder is never a project's.
    expect(projectMediaFolder({ cover: { kind: 'image', src: '/media/site/a.webp' } }, 'own', HOSTS)).toBe('own');
  });

  it('takes uploads while saved content points into it, after its project was renamed', () => {
    const info = { stored: { 'content/projects/raven-evtol.json': '{"cover":{"src":"/media/raven/cover.webp"}}' } };
    expect(folderExists({ info } as never, 'raven')).toBe(true);
    expect(folderExists({ info } as never, 'raven-evtol')).toBe(true);
    expect(folderExists({ info } as never, 'never-saved')).toBe(false);
    expect(folderExists({ info } as never, 'site')).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// CLIENT-7: a file named like a resume
// ---------------------------------------------------------------------------------------------

describe('a file named like a resume', () => {
  it('asks before it is stored, by its dropped or its stored name', () => {
    expect(resumeWarning(['Amjad_Rehawi_Resume.pdf', 'amjad-rehawi-resume.pdf'])).toEqual({ code: 'resume-name', message: RESUME_QUESTION, confirm: true });
    expect(resumeWarning(['photo.jpg', 'cv.webp'])).not.toBeNull();
    expect(resumeWarning(['report.pdf', 'report.pdf'])).toBeNull();
    expect(RESUME_QUESTION).toBe('No resume file is ever served on this site. Upload it anyway?');
  });

  it('is marked in the library', () => {
    expect(isResumeName('old-resume.pdf')).toBe(true);
    expect(isResumeName('curriculum-vitae.docx')).toBe(true);
    expect(isResumeName('presume.webp')).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// CLIENT-2: following a field's place through one change
// ---------------------------------------------------------------------------------------------

describe('an upload\'s place, through one change', () => {
  const a = { id: 'rv-a', type: 'image', media: { src: 'a' } };
  const b = { id: 'rv-b', type: 'image', media: { src: 'b' } };
  const path = ['blocks', 0, 'media'];

  it('is found by its object when its row moved, and by its id when its block was edited', () => {
    expect(followPath({ blocks: [a, b] }, { blocks: [b, a] }, path)).toEqual(['blocks', 1, 'media']);
    const edited = { ...a, media: { src: 'a2' } };
    expect(followPath({ blocks: [a, b] }, { blocks: [{ id: 'z' }, b, edited] }, path)).toEqual(['blocks', 2, 'media']);
  });

  it('keeps the position of a row edited where it is, and is gone with a removed row', () => {
    const x = { src: 'x' };
    const y = { src: 'y' };
    expect(followPath({ items: [x, y] }, { items: [x, { src: 'y2' }] }, ['items', 1])).toEqual(['items', 1]);
    expect(followPath({ blocks: [a, b] }, { blocks: [b] }, path)).toBeNull();
    // Found again (after an undo) only by an unchanged object or a block's id, never by position.
    expect(followPath({ items: [x, y] }, { items: [x, { src: 'other' }] }, ['items', 1], true)).toBeNull();
    expect(followPath({ blocks: [a, b] }, { blocks: [b, a] }, path, true)).toEqual(['blocks', 1, 'media']);
  });
});

// ---------------------------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------------------------

describe('keep both: free names', () => {
  it('numbers the main file and names the poster after it, without case', () => {
    expect(freeNames('clip.mp4', 'clip-poster.webp', ['clip.mp4', 'CLIP-2.mp4', 'clip-poster.webp'])).toEqual({ main: 'clip-3.mp4', poster: 'clip-3-poster.webp' });
    expect(freeNames('photo.webp', null, ['photo.webp'])).toEqual({ main: 'photo-2.webp', poster: null });
  });

  it('skips a number whose poster name is taken', () => {
    expect(freeNames('clip.mp4', 'clip-poster.webp', ['clip.mp4', 'clip-2-poster.webp'])).toEqual({ main: 'clip-3.mp4', poster: 'clip-3-poster.webp' });
  });

  it('cleans names the way the server does and keeps the number inside the 64-character base', () => {
    expect(freeName('My Photo.WEBP', [])).toBe('my-photo.webp');
    const long = `${'a'.repeat(70)}.webp`;
    const taken = ['a'.repeat(64) + '.webp'];
    const free = freeName(long, taken);
    expect(free).toBe(`${'a'.repeat(62)}-2.webp`);
  });

  it('reads a Blob name without its random ending, and finds the poster stored beside a file', () => {
    expect(givenName('clip-0123456789ab.mp4')).toBe('clip.mp4');
    expect(givenName('photo-2.webp')).toBe('photo-2.webp');
    const files = [item('clip.mp4'), item('clip-poster.webp'), item('photo.webp')];
    expect(findPosterItem(files[0], files)?.name).toBe('clip-poster.webp');
    expect(findPosterItem(files[2], files)).toBeNull();
    const blob = item('clip-0123456789ab.mp4', { store: 'blob' });
    expect(findPosterItem(blob, files)?.name).toBe('clip-poster.webp');
  });
});

// ---------------------------------------------------------------------------------------------
// The content check over a file's words
// ---------------------------------------------------------------------------------------------

describe('content-check requests', () => {
  it('reads the name, the text, and each part name, with labels that never repeat the text', () => {
    const items = checkItemsFor('report.pdf', { meta: { text: 'Some words', partNames: ['Frame', '', 'Motor mount'] } });
    expect(items).toEqual([
      { label: 'name', text: 'report.pdf' },
      { label: 'text', text: 'Some words' },
      { label: 'model name 1', text: 'Frame' },
      { label: 'model name 3', text: 'Motor mount' },
    ]);
  });

  it('cuts long text into overlapping pieces so a phrase across a cut is whole in one piece', () => {
    const text = `${'x'.repeat(250)}needle phrase${'y'.repeat(250)}`;
    const pieces = chunkText(text, 100, 20);
    expect(pieces.every((piece) => piece.length <= 100)).toBe(true);
    expect(pieces.some((piece) => piece.includes('needle phrase'))).toBe(true);
    expect(pieces.join('').length).toBeGreaterThan(text.length);
    expect(chunkText('short')).toEqual(['short']);
  });

  it('never cuts a surrogate pair', () => {
    const text = 'a'.repeat(99) + '\u{1F600}' + 'b'.repeat(150);
    for (const piece of chunkText(text, 100, 10)) {
      const first = piece.charCodeAt(0);
      const last = piece.charCodeAt(piece.length - 1);
      expect(first >= 0xdc00 && first <= 0xdfff).toBe(false);
      expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
    }
  });

  it('keeps every request under the route limits, the longest text included', () => {
    const text = 'word '.repeat(1_700_000);
    const parts = Array.from({ length: 2500 }, (_, i) => `part ${i}`);
    const bodies = checkBodies('big.pdf', checkItemsFor('big.pdf', { meta: { text, partNames: parts } }));
    expect(bodies.length).toBeGreaterThan(1);
    const encoder = new TextEncoder();
    for (const body of bodies) {
      expect(encoder.encode(JSON.stringify(body)).length).toBeLessThanOrEqual(MAX_CHECK_TEXT_BYTES);
      expect(body.items.length).toBeLessThanOrEqual(MAX_CHECK_ITEMS);
      expect(body.source).toBe('big.pdf');
    }
    const all = bodies.flatMap((body) => body.items);
    expect(all.filter((entry) => entry.label.startsWith('model name'))).toHaveLength(2500);
    expect(all.filter((entry) => entry.label.startsWith('text')).map((entry) => entry.text).join('').length).toBeGreaterThanOrEqual(text.length);
  });

  it('reports a hit found twice in overlapping pieces once', () => {
    const finding = { file: 'big.pdf', rule: 'IP-CLAIM', message: 'm', severity: 'error' as const };
    expect(uniqueFindings([
      { ...finding, path: 'text, part 1 of 3' },
      { ...finding, path: 'text, part 2 of 3' },
      { ...finding, path: 'name' },
    ])).toHaveLength(2);
  });
});
