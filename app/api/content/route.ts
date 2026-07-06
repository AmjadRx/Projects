import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { ghConfigured, ghGetFile, ghListDir } from '@/lib/github';
import type { Project, Site } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Latest content: from GitHub when configured (admin edits the live repo), else local files. */
export async function GET() {
  try {
    if (ghConfigured()) {
      const siteFile = await ghGetFile('content/site.json');
      if (!siteFile) throw new Error('content/site.json not found in repo');
      const site = JSON.parse(siteFile.content.toString('utf8')) as Site;
      const entries = await ghListDir('content/projects');
      const projects: Project[] = [];
      for (const entry of entries.filter((e) => e.type === 'file' && e.name.endsWith('.json'))) {
        const file = await ghGetFile(entry.path);
        if (file) projects.push(JSON.parse(file.content.toString('utf8')) as Project);
      }
      projects.sort((a, b) => a.order - b.order);
      return NextResponse.json(
        { site, projects, source: 'github' },
        { headers: { 'cache-control': 'no-store' } },
      );
    }

    const dir = path.join(process.cwd(), 'content');
    const site = JSON.parse(fs.readFileSync(path.join(dir, 'site.json'), 'utf8')) as Site;
    const projectsDir = path.join(dir, 'projects');
    const projects = fs
      .readdirSync(projectsDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(fs.readFileSync(path.join(projectsDir, f), 'utf8')) as Project)
      .sort((a, b) => a.order - b.order);
    return NextResponse.json(
      { site, projects, source: 'fs' },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500, headers: { 'cache-control': 'no-store' } },
    );
  }
}
