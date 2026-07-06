import fs from 'fs';
import path from 'path';
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
      if (media.src.startsWith('/media/')) {
        media.exists = fs.existsSync(path.join(PUBLIC_DIR, media.src));
      } else {
        media.exists = true;
      }
    }
    Object.values(obj).forEach(annotateMedia);
  }
}

function readContent(): Content {
  const site = JSON.parse(
    fs.readFileSync(path.join(CONTENT_DIR, 'site.json'), 'utf8'),
  ) as Site;
  const dir = path.join(CONTENT_DIR, 'projects');
  const projects: Project[] = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as Project)
    .sort((a, b) => a.order - b.order);
  annotateMedia(site);
  annotateMedia(projects);
  return { site, projects };
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
