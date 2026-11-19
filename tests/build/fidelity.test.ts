/**
 * Every page renders the content exactly (ARCHITECTURE.md 14, Phase 3; 15, item 1): the test
 * builds the site from content/ into its own output folder and checks that each string the
 * pages are meant to show appears, unchanged, in the text of the built HTML; that the parts of
 * each page come in the order of ARCHITECTURE.md 5; that composed lines (the hero degree line,
 * each readout, each about fact) are printed whole in their own element; and that the JSON-LD
 * holds what D-41 allows. Markdown is compared as the text it renders to. Run it with
 * `npm run test:build`.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gpaText, hasText, isGpaFact, statText, statusText } from '../../lib/format';
import { isKnownBlock } from '../../lib/schema';
import { UI } from '../../lib/strings';
import type { Block, Project, Site } from '../../lib/types';

const root = path.resolve(__dirname, '..', '..');
const distName = '.next-fidelity-test';
const appOut = path.join(root, distName, 'server', 'app');

const site: Site = JSON.parse(fs.readFileSync(path.join(root, 'content', 'site.json'), 'utf8'));
const projects: Project[] = fs
  .readdirSync(path.join(root, 'content', 'projects'))
  .map((name) => JSON.parse(fs.readFileSync(path.join(root, 'content', 'projects', name), 'utf8')) as Project)
  .filter((p) => p.visible)
  .sort((a, b) => a.order - b.order);

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** The visible text of an HTML fragment: scripts and styles dropped, tags removed, entities decoded. */
function textOf(htmlText: string): string {
  return htmlText
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
      if (code[0] === '#') return String.fromCodePoint(code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10));
      return ENTITIES[code.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

function rawHtml(route: string): string {
  return fs.readFileSync(path.join(appOut, route === '/' ? 'index.html' : `${route.slice(1)}.html`), 'utf8');
}

function pageText(route: string): string {
  return textOf(rawHtml(route));
}

/** The main landmark only, so the nav and the footer cannot stand in for page content. */
function mainHtml(route: string): string {
  const page = rawHtml(route);
  const match = /<main\b[^>]*>([\s\S]*)<\/main>/.exec(page);
  if (!match) throw new Error(`${route}: no main element`);
  return match[1];
}

/** Markdown as the plain text it renders to (the subset the site allows). */
function mdText(md: string): string[] {
  return md
    .split(/\n\s*\n|\n- |\n\* |^- /m)
    .map((part) =>
      part
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/(\*\*|__)(.*?)\1/g, '$2')
        .replace(/(\*|_)(.*?)\1/g, '$2')
        .replace(/`([^`]*)`/g, '$1')
        .replace(/^\s*[-*]\s+/gm, '')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter(Boolean);
}

function blockStrings(blocks: Block[]): string[] {
  const out: string[] = [];
  for (const block of blocks) {
    if (!isKnownBlock(block)) continue;
    switch (block.type) {
      case 'heading':
        out.push(block.text);
        break;
      case 'text':
      case 'callout':
        out.push(...mdText(block.md));
        break;
      case 'bullets':
        if (block.heading) out.push(block.heading);
        for (const item of block.items) out.push(...mdText(item));
        break;
      case 'specTable':
        for (const row of block.rows) out.push(row.label, row.value);
        break;
      case 'quote':
        out.push(block.text);
        if (block.attribution) out.push(block.attribution);
        break;
      case 'linkRow':
        for (const link of block.links) out.push(link.label);
        break;
      case 'roadmap':
        for (const stage of block.stages) out.push(stage.title, UI.roadmapStatus[stage.status], stage.desc);
        break;
      case 'log':
        for (const entry of block.entries) out.push(entry.date, entry.title, ...mdText(entry.md));
        break;
      case 'twoCol':
        out.push(...blockStrings(block.left), ...blockStrings(block.right));
        break;
      case 'file':
        out.push(block.label);
        if (block.note) out.push(block.note);
        break;
      case 'document':
      case 'audio':
        if (block.title) out.push(block.title);
        break;
      default:
        break;
    }
  }
  return out.filter(hasText);
}

/** Callout labels: a callout block names its tone in words. */
function calloutLabels(blocks: Block[]): string[] {
  const out: string[] = [];
  for (const block of blocks) {
    if (!isKnownBlock(block)) continue;
    if (block.type === 'callout' && hasText(block.md)) out.push(block.tone === 'status' ? UI.callout.status : UI.callout.note);
    if (block.type === 'twoCol') out.push(...calloutLabels(block.left), ...calloutLabels(block.right));
  }
  return out;
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

function missing(text: string, expected: string[]): string[] {
  return [...new Set(expected.filter(hasText).map(norm))].filter((s) => !text.includes(s));
}

/** The first string that is missing or out of order in `text`, or null when all come in order. */
function outOfOrder(text: string, expected: string[]): string | null {
  let from = 0;
  for (const item of expected.filter(hasText).map(norm)) {
    const at = text.indexOf(item, from);
    if (at === -1) return item;
    from = at + item.length;
  }
  return null;
}

/**
 * The text of every element of a tag in a fragment, in order. Child elements are separated by a
 * space (a readout's value and label are two spans), so compare with "value label".
 */
function elementTexts(fragment: string, tag: string): string[] {
  return [...fragment.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'g'))].map((m) =>
    textOf(m[1].replace(/></g, '> <')),
  );
}

function jsonLdBlocks(page: string): any[] {
  return [...page.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
}

describe('every page renders the content exactly', () => {
  beforeAll(() => {
    fs.rmSync(path.join(root, distName), { recursive: true, force: true });
    execFileSync(process.execPath, [path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next'), 'build'], {
      cwd: root,
      env: { ...process.env, NEXT_DIST_DIR: distName, NEXT_TELEMETRY_DISABLED: '1' },
      stdio: 'pipe',
      maxBuffer: 64 * 1024 * 1024,
    });
  });

  afterAll(() => {
    fs.rmSync(path.join(root, distName), { recursive: true, force: true });
  });

  it('no browser chunk carries ndarray-ops, which builds functions from strings the admin policy refuses', () => {
    // Every model upload failed on the Phase 6 preview this way; a dev server allows it, so only a
    // production build shows it. next.config.mjs points ndarray-pixels at a stub in browser
    // bundles (lib/admin/convert/ndarray-pixels-browser.js); this keeps it from coming back.
    const chunks = path.join(root, distName, 'static', 'chunks');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.js') && /_ndarrayops|cwise/.test(fs.readFileSync(full, 'utf8'))) offenders.push(path.relative(chunks, full));
      }
    };
    walk(chunks);
    expect(offenders).toEqual([]);
  });

  it('home: hero, readouts, thesis, now, selected work, about teaser, tools, contact call', () => {
    const { personal, thesis } = site;
    const expected = [
      personal.tagline,
      personal.subTagline,
      site.settings.showAvailabilityBadge ? personal.availability : '',
      thesis.kicker,
      thesis.headline,
      thesis.body,
      // A pillar's key (the letters A to D) is not drawn: the design shows each pillar by its title
      // (Phase 4). A one-letter key could not be checked here anyway, since any page holds it.
      ...thesis.pillars.flatMap((p) => [p.title, p.desc]),
      ...site.now.map((n) => n.label),
      ...projects.flatMap((p) => [p.title, p.pitch, statusText(p), p.maturity?.label ?? '']),
      site.about.heading,
      site.about.paragraphs.find(hasText) ?? '',
      ...site.skills.groups.flatMap((g) => g.items.map((i) => i.label)),
      site.contact.heading,
      site.contact.body,
    ];
    expect(missing(pageText('/'), expected)).toEqual([]);
  });

  it('home: the sections come in the order of ARCHITECTURE.md 5', () => {
    const main = mainHtml('/');
    const ids = ['readouts-title', 'thesis-title', 'now-title', 'work-title', 'about-title', 'tools-title', 'contact-call-title'];
    const positions = ids.map((id) => main.indexOf(`id="${id}"`));
    expect(positions.every((p) => p > -1), ids.filter((_, i) => positions[i] === -1).join(', ')).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(main.indexOf('<h1')).toBeLessThan(positions[0]);
  });

  it('home: the degree line is printed whole in its own element, the GPA with its label', () => {
    const { personal } = site;
    const expected = [personal.degree, personal.school, gpaText(personal), hasText(personal.graduation) ? `${UI.hero.graduation} ${personal.graduation}` : '']
      .filter(hasText)
      .join(' · ');
    const lines = elementTexts(mainHtml('/'), 'p').filter((t) => t.includes(personal.degree));
    expect(lines).toEqual([expected]);
  });

  it('home: each readout prints its value and its label together, in content order', () => {
    const main = mainHtml('/');
    // A linked readout also names its proof's project for screen readers (a visually hidden span
    // after the label); the visible text of each tile is what is compared.
    const list = main
      .slice(main.indexOf('id="readouts-title"'), main.indexOf('id="thesis-title"'))
      .replace(/<span class="ar-sr">[\s\S]*?<\/span>/g, '');
    const shown = site.stats.filter((s) => hasText(s.value) && hasText(s.label));
    expect(elementTexts(list, 'li')).toEqual(shown.map((s) => `${statText(s)} ${s.label}`));
  });

  it('home: the Person JSON-LD holds only shown fields (D-41)', () => {
    const person = jsonLdBlocks(rawHtml('/')).find((b) => b['@type'] === 'Person');
    expect(person).toBeDefined();
    const profiles = site.socialLinks
      .filter((l) => l.showInFooter && /^https:\/\/(www\.)?(linkedin\.com|github\.com)\//i.test(l.url))
      .map((l) => l.url);
    expect(person.name).toBe(site.personal.name);
    expect(person.sameAs).toEqual(profiles);
    expect(person.telephone).toBeUndefined();
    expect(person.alumniOf).toBeUndefined();
    expect(person.affiliation).toEqual({ '@type': 'CollegeOrUniversity', name: site.personal.school });
  });

  it('shared frame: name, nav, footer tagline, email, and footer links on every page', () => {
    const footerLinks = site.socialLinks.filter((l) => l.showInFooter && !l.url.startsWith('mailto:')).map((l) => l.label);
    for (const route of ['/', '/projects', '/about', '/experience', '/log', '/contact']) {
      const expected = [site.personal.name, ...site.nav.map((n) => n.label), site.personal.tagline, site.personal.email, ...footerLinks];
      expect(missing(pageText(route), expected), route).toEqual([]);
    }
  });

  it('shared frame: LinkedIn is shown as the word "LinkedIn" in the header (CONTENT_RULES.md 4)', () => {
    const header = /<header\b[\s\S]*?<\/header>/.exec(rawHtml('/'))?.[0] ?? '';
    for (const link of site.socialLinks.filter((l) => l.showInNav && !l.url.startsWith('mailto:'))) {
      const anchor = [...header.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].find((m) => m[1] === link.url);
      expect(anchor, link.label).toBeDefined();
      const visible = textOf(anchor![2].replace(/<span class="sr-only">[\s\S]*?<\/span>/g, ''));
      expect(visible, link.label).toBe(link.label);
    }
  });

  it('every project page: title block, pitch, highlights, progress, callouts, and every block, in order', () => {
    projects.forEach((project, index) => {
      const route = `/projects/${project.slug}`;
      const expected = [
        project.title,
        project.subtitle,
        project.role,
        project.timeframe,
        statusText(project),
        project.maturity?.label ?? '',
        `${index + 1} OF ${projects.length}`,
        project.pitch,
        ...project.highlights,
        ...(project.progress?.steps.map((s) => s.label) ?? []),
        ...(project.callouts ?? []).flatMap((c) => [c.label, c.value]),
        ...project.links.map((l) => l.label),
        ...blockStrings(project.blocks),
        ...calloutLabels(project.blocks),
      ];
      expect(missing(pageText(route), expected), project.slug).toEqual([]);

      const main = textOf(mainHtml(route));
      const order = [
        UI.projects.backToProjects,
        project.title,
        project.subtitle,
        ...(project.callouts ?? []).filter((c) => hasText(c.label) && hasText(c.value)).map((c) => c.label),
        `${index + 1} OF ${projects.length}`,
        project.pitch,
        project.highlights.find(hasText) ?? '',
        project.progress?.steps.find((s) => hasText(s.label))?.label ?? '',
        blockStrings(project.blocks)[0] ?? '',
      ];
      expect(outOfOrder(main, order), project.slug).toBeNull();

      const work = jsonLdBlocks(rawHtml(route)).find((b) => b['@type'] === 'CreativeWork');
      expect(work?.name, project.slug).toBe(project.title);
      if (hasText(project.role)) expect(work?.contributor?.roleName, project.slug).toBe(project.role);
      expect(work?.contributor?.telephone, project.slug).toBeUndefined();
    });
  });

  it('projects: every visible project, and its domains in the filter', () => {
    const page = pageText('/projects');
    expect(missing(page, projects.flatMap((p) => [p.title, p.pitch, statusText(p)]))).toEqual([]);
    expect(outOfOrder(textOf(mainHtml('/projects')), projects.map((p) => p.title))).toBeNull();
    const raw = rawHtml('/projects');
    for (const project of projects) {
      for (const domain of project.domain.split(',').map((d) => d.trim()).filter(Boolean)) {
        expect(raw.toLowerCase().includes(domain.toLowerCase().replace(/&/g, '&amp;')), domain).toBe(true);
      }
    }
  });

  it('about: paragraphs, facts (the GPA with its label), skills, education, honors, in order', () => {
    const { about, personal } = site;
    const expected = [
      about.heading,
      ...about.paragraphs,
      ...site.skills.groups.flatMap((g) => [g.title, ...g.items.map((i) => i.label)]),
      ...site.education.flatMap((e) => [e.school, e.degree, e.details, e.dates]),
      ...site.honors.flatMap((h) => [h.title, h.year, h.note]),
    ];
    expect(missing(pageText('/about'), expected)).toEqual([]);

    const main = mainHtml('/about');
    const facts = /<dl aria-label="Facts"[^>]*>([\s\S]*?)<\/dl>/.exec(main)?.[1] ?? '';
    const shownFacts = about.facts.filter((f) => (isGpaFact(f, personal) ? gpaText(personal) !== '' : hasText(f.label) && hasText(f.value)));
    const pairs = shownFacts.map((f) => (isGpaFact(f, personal) ? gpaText(personal) : `${f.label} ${f.value}`));
    expect(elementTexts(facts, 'div')).toEqual(pairs);

    const ids = ['skills-title', 'education-title', 'honors-title'].map((id) => main.indexOf(`id="${id}"`));
    expect(ids.every((p) => p > -1)).toBe(true);
    expect([...ids].sort((a, b) => a - b)).toEqual(ids);
    expect(main.indexOf('aria-label="Facts"')).toBeLessThan(ids[0]);
    expect(outOfOrder(textOf(main.slice(0, ids[0])), [about.heading, ...about.paragraphs.filter(hasText)])).toBeNull();
  });

  it('experience: every role with its bullets, in content order', () => {
    const expected = site.experience.flatMap((e) => [e.company, e.role, e.location, e.dates, ...e.bullets]);
    expect(missing(pageText('/experience'), expected)).toEqual([]);
    expect(outOfOrder(textOf(mainHtml('/experience')), site.experience.map((e) => e.role))).toBeNull();
  });

  it('log: every entry of every visible project, with its project', () => {
    const expected: string[] = [];
    const walk = (blocks: Block[], project: Project) => {
      for (const block of blocks) {
        if (!isKnownBlock(block)) continue;
        if (block.type === 'log') {
          for (const entry of block.entries) expected.push(entry.date, entry.title, ...mdText(entry.md), project.title);
        }
        if (block.type === 'twoCol') {
          walk(block.left, project);
          walk(block.right, project);
        }
      }
    };
    projects.forEach((p) => walk(p.blocks, p));
    expect(expected.length).toBeGreaterThan(0);
    expect(missing(pageText('/log'), expected)).toEqual([]);
  });

  it('contact: heading, body, email, the contact links, the resume request, the location, in that order', () => {
    const { contact, personal } = site;
    const links = site.socialLinks
      .filter((l) => l.showInContact && !l.url.startsWith('mailto:'))
      .filter((l) => !l.url.startsWith('tel:') || hasText(personal.phone))
      .map((l) => l.label);
    const resumeLabel = contact.resumeRequest?.enabled ? contact.resumeRequest.label : '';
    const order = [contact.heading, contact.body, personal.email, ...links, resumeLabel, personal.location];
    expect(outOfOrder(textOf(mainHtml('/contact')), order)).toBeNull();
    if (contact.resumeRequest?.enabled) {
      const href = `mailto:${personal.email}?subject=${encodeURIComponent(contact.resumeRequest.subject)}&body=${encodeURIComponent(contact.resumeRequest.body)}`;
      expect(rawHtml('/contact')).toContain(`href="${href.replace(/&/g, '&amp;')}"`);
    }
  });

  it('prints the GPA only as its label and value together', () => {
    const gpa = gpaText(site.personal);
    if (!gpa) return;
    for (const route of ['/', '/projects', '/about', '/experience', '/log', '/contact', ...projects.map((p) => `/projects/${p.slug}`)]) {
      const text = pageText(route);
      const bare = text.split(site.personal.gpa).length - 1;
      const labelled = text.split(gpa).length - 1;
      expect(bare, route).toBe(labelled);
    }
  });

  it('the 404 page says "Sheet not found" and links home and to projects', () => {
    const page = fs.readFileSync(path.join(appOut, '_not-found.html'), 'utf8');
    expect(textOf(page)).toContain('Sheet not found');
    const main = /<main\b[^>]*>([\s\S]*)<\/main>/.exec(page)?.[1] ?? page;
    expect(main).toMatch(/href="\/"/);
    expect(main).toMatch(/href="\/projects"/);
  });
});
