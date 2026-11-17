/**
 * Bridge for the v2 pages until Phase 3 rebuilds them on schema version 3
 * (docs/V3_PLAN.md R-22). Delete this folder with them.
 *
 * Content is read through the v3 loaders, so it is validated, and then reshaped into the v2
 * types those pages expect:
 * - a skill item becomes its label;
 * - a stat's prefix joins its value, so an approximate value keeps its "~";
 * - every hero mode becomes "media", because v2 has no drawing or model mode and the procedural
 *   3D scene must never show (ARCHITECTURE.md section 6);
 * - a media file is marked missing when its src is empty or absent from public/media, so the
 *   page shows the placeholder instead of a broken image.
 * Only visible projects are returned.
 */
import fs from 'fs';
import path from 'path';
import { loadPublicProjects, loadSite as loadSiteV3 } from '@/lib/content';
import type { Content, MediaRef, Project, Site } from './types';

const CONTENT_DIR = path.join(process.cwd(), 'content');
const PUBLIC_DIR = path.join(process.cwd(), 'public');

let cache: Content | null = null;
let lastUpdatedCache: string | null = null;

function annotateMedia(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(annotateMedia);
    return;
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (
      typeof obj.kind === 'string' &&
      typeof obj.src === 'string' &&
      ['image', 'video', 'embed'].includes(obj.kind as string)
    ) {
      const media = obj as unknown as MediaRef;
      if (media.src === '') media.exists = false;
      else if (media.src.startsWith('/media/')) media.exists = fs.existsSync(path.join(PUBLIC_DIR, media.src));
      else media.exists = true;
    }
    Object.values(obj).forEach(annotateMedia);
  }
}

function toV2Site(): Site {
  const v3 = structuredClone(loadSiteV3());
  const site = {
    ...v3,
    settings: { ...v3.settings, heroMode: 'media' as const },
    stats: v3.stats.map((stat) => ({ ...stat, value: `${stat.prefix ?? ''}${stat.value}` })),
    skills: {
      groups: v3.skills.groups.map((group) => ({ ...group, items: group.items.map((item) => item.label) })),
    },
  };
  annotateMedia(site);
  return site as unknown as Site;
}

function toV2Projects(): Project[] {
  const projects = structuredClone(loadPublicProjects());
  annotateMedia(projects);
  return projects as unknown as Project[];
}

function readContent(): Content {
  return { site: toV2Site(), projects: toV2Projects() };
}

export function loadContent(): Content {
  if (process.env.NODE_ENV === 'development') return readContent();
  if (!cache) cache = readContent();
  return cache;
}

export function loadSite(): Site {
  return loadContent().site;
}

export function loadProjects(): Project[] {
  return loadContent().projects;
}

export function loadProject(slug: string): Project | undefined {
  return loadProjects().find((p) => p.slug === slug);
}

export function lastUpdated(): string {
  if (lastUpdatedCache && process.env.NODE_ENV !== 'development') return lastUpdatedCache;
  let latest = 0;
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else latest = Math.max(latest, fs.statSync(p).mtimeMs);
    }
  };
  try {
    walk(CONTENT_DIR);
  } catch {
    latest = Date.now();
  }
  lastUpdatedCache = new Date(latest || Date.now()).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });
  return lastUpdatedCache;
}
