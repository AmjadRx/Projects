/**
 * What each Open Graph image shows, built only from fields its page shows (ARCHITECTURE.md 5 and
 * 15, item 2): the home image the owner's name and the headline; a project image its title,
 * subtitle, and title block fields. An empty field is left out, never drawn as a dash or an empty
 * label, and the GPA is not on any image. The alt text is read from the same model, so it names
 * the fields the image draws.
 */
import { createHash } from 'node:crypto';
import { hasText, statusText } from '../format';
import { UI } from '../strings';
import type { Project, Site } from '../types';

/** Every Open Graph image is 1200 by 630 px, the size link previews ask for. */
export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

export interface HomeCard {
  kind: 'home';
  /** The hero's headline: the tagline, or the name when the tagline is empty (components/home/Hero.tsx). */
  headline?: string;
  /** The owner's name, in the title block. */
  name?: string;
}

export interface ProjectCard {
  kind: 'project';
  title: string;
  subtitle?: string;
  /** SHEET n OF N: the project's place among the visible projects, and how many are visible. */
  sheet: number;
  sheets: number;
  role?: string;
  dates?: string;
  status: string;
  /** REV: the date of the project's last content commit, when it is known. */
  rev?: string;
  maturity?: { step: number; label: string };
}

export type Card = HomeCard | ProjectCard;

const trimmed = (value: string | undefined | null) => (hasText(value) ? value.trim() : undefined);

export function homeCard(site: Pick<Site, 'personal'>): HomeCard {
  const name = trimmed(site.personal.name);
  const headline = trimmed(site.personal.tagline) ?? name;
  return { kind: 'home', ...(headline ? { headline } : {}), ...(name ? { name } : {}) };
}

/**
 * A project's image, as its title block shows it (components/sheet/TitleBlock.tsx): `sheet` and
 * `sheets` count visible projects only, so a hidden project leaves no gap or count behind.
 */
export function projectCard(project: Project, sheet: number, sheets: number, rev?: string): ProjectCard {
  const maturity = project.maturity && hasText(project.maturity.label) ? project.maturity : undefined;
  const subtitle = trimmed(project.subtitle);
  const role = trimmed(project.role);
  const dates = trimmed(project.timeframe);
  const revDate = trimmed(rev);
  return {
    kind: 'project',
    title: project.title.trim(),
    ...(subtitle ? { subtitle } : {}),
    sheet,
    sheets,
    ...(role ? { role } : {}),
    ...(dates ? { dates } : {}),
    status: statusText(project).trim(),
    ...(revDate ? { rev: revDate } : {}),
    ...(maturity ? { maturity: { step: Math.min(5, Math.max(1, Math.round(maturity.step))), label: maturity.label.trim() } } : {}),
  };
}

/**
 * The owner's initials: the first letter of the first and of the last word of the name, in
 * capitals. One word gives one letter; an empty name gives none.
 */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  const first = (word: string) => [...word][0] ?? '';
  const letters = words.length === 1 ? first(words[0]) : first(words[0]) + first(words[words.length - 1]);
  return letters.toLocaleUpperCase('en-US');
}

/** Sentences from parts, each ended with a full stop unless it already ends a sentence. */
function sentences(parts: (string | undefined)[]): string {
  return parts
    .filter(hasText)
    .map((part) => part.trim())
    .map((part) => (/[.!?]$/.test(part) ? part : `${part}.`))
    .join(' ');
}

/**
 * The image's alt text: what it draws, in reading order, with the title block's own labels. Every
 * field it names has its cell on the image (lib/og/sheet.tsx keeps them all on the sheet), and it
 * reads each value whole, also the rare one the image had to cut short.
 */
export function cardAlt(card: Card): string {
  if (card.kind === 'home') {
    return sentences([card.headline !== card.name ? card.headline : undefined, card.name ? `${UI.seo.name}: ${card.name}` : undefined]);
  }
  return sentences([
    card.title,
    card.subtitle,
    UI.projects.sheetOf(card.sheet, card.sheets),
    card.role ? `${UI.titleBlock.role}: ${card.role}` : undefined,
    card.dates ? `${UI.titleBlock.dates}: ${card.dates}` : undefined,
    card.status ? `${UI.titleBlock.status}: ${card.status}` : undefined,
    card.rev ? `${UI.titleBlock.rev} ${card.rev}` : undefined,
    card.maturity ? `${UI.maturity.label}: ${card.maturity.label}` : undefined,
  ]);
}

/**
 * Bumped by hand whenever the drawing itself changes (lib/og/sheet.tsx), so the images' addresses
 * change with them and link previews that cached an older image fetch the new one. 2: long content
 * steps the type down to stay on the sheet, and the first line's tall letters are no longer clipped.
 */
export const DRAWING_VERSION = 2;

/** A short version for the image's address: it changes whenever what the image draws changes. */
export function cardVersion(card: Card, palette: unknown): string {
  return createHash('sha256').update(JSON.stringify([DRAWING_VERSION, card, palette])).digest('hex').slice(0, 10);
}
