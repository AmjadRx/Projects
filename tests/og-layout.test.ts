/**
 * The Open Graph images keep everything on the sheet whatever the content's length
 * (lib/og/sheet.tsx cardLayout): the title block stands on the frame's bottom right corner and
 * rises no higher than a band's width under the heat rule, the text stays inside its area and clear
 * of the block, and every field keeps its cell. A long title block steps its type down, then widens;
 * a long title and subtitle step down together. Text is cut short with an ellipsis only far past
 * any real field's length.
 *
 * Built from the seed's visible projects as the routes draw them (only read, never changed), with
 * the design's long-title test string (States-LongTitle-390), and from test strings that say they
 * are not content.
 */
import { describe, expect, it } from 'vitest';
import type { Card, HomeCard, ProjectCard } from '../lib/og/cards';
import { cardLayout, drawnText, SHEET_AREAS } from '../lib/og/sheet';
import { imageSlugs, siteHomeCard, siteProjectCard } from '../lib/og/site-cards';
import { UI } from '../lib/strings';

/** The design's long-title test string: 72 characters, "Never cut short" (States-LongTitle-390). */
const LONG_TITLE = 'A test title, not a project: long enough to take five lines at full size';

/** A card with every field long: a role, dates, status, and maturity label each of two to three lines. */
const WORST: ProjectCard = {
  kind: 'project',
  title: LONG_TITLE,
  subtitle: 'A test subtitle, not content: long enough to take three lines in the column beside the title block',
  sheet: 12,
  sheets: 12,
  role: 'A test role, not a project field: long enough to take three lines in its cell',
  dates: 'Sep 2023 to present, with a gap from Jun 2024 to Sep 2024',
  status: 'A test status, not a project field: long enough to take three lines',
  rev: '2026-11-16',
  maturity: { step: 3, label: 'A test maturity label, not a project field: long enough for two lines' },
};

const longer = (text: string) => `${text}, and then some more words to make it longer still`;
const times = (text: string, n: number) => Array.from({ length: n }, () => text).join(' ');

/** A role and a status too long for the block at its first width, even at its smallest type. */
const WIDER: ProjectCard = { ...WORST, role: longer(WORST.role!), status: longer(WORST.status) };

/** Every field far past any real one's length. */
const ABSURD: ProjectCard = {
  ...WORST,
  title: times(LONG_TITLE, 6),
  subtitle: times(WORST.subtitle!, 8),
  role: times(WORST.role!, 12),
  dates: times(WORST.dates!, 6),
  status: times(WORST.status, 12),
  maturity: { step: 5, label: times(WORST.maturity!.label, 12) },
};

const seedProjects = () => imageSlugs().map(({ slug }) => siteProjectCard(slug)!);

/** Asserts that a card's text and title block stay where the sheet allows. */
function expectOnSheet(card: Card, name: string) {
  const { text, block } = cardLayout(card);
  const { frame, heat, text: area, gap } = SHEET_AREAS;
  if (block) {
    // The block's outer lines on the frame's right and bottom lines, inside the frame's left.
    expect(block.left + block.width, name).toBe(frame.left + frame.width);
    expect(block.top + block.height, name).toBe(frame.top + frame.height);
    expect(block.left, name).toBeGreaterThan(frame.left);
    // Below the heat rule, with room to spare: a band's width, or the frame's lower half on the home image.
    expect(block.top, name).toBeGreaterThan(heat.top + heat.height);
    expect(block.top, name).toBeGreaterThanOrEqual(card.kind === 'home' ? SHEET_AREAS.homeBlockTop : SHEET_AREAS.blockTop);
  }
  if (text) {
    expect(text.left, name).toBe(area.left);
    expect(text.top, name).toBe(area.top);
    expect(text.left + text.width, name).toBeLessThanOrEqual(area.left + area.width);
    expect(text.height, name).toBeGreaterThan(0);
    expect(text.top + text.height, name).toBeLessThanOrEqual(area.top + area.height);
    if (block) {
      // Beside the block (the column), or above it (across the sheet), with the gap between.
      const beside = text.left + text.width + gap <= block.left;
      const above = text.top + text.height + gap <= block.top;
      expect(beside || above, name).toBe(true);
    }
  }
}

/** The title block's labels an image draws, in capitals as drawn. */
const labels = (card: Card) => drawnText(card).filter((s) => /^[A-Z]{3,}$/.test(s));

describe('a project image', () => {
  it('draws every visible seed project on the sheet, whole', () => {
    const cards = seedProjects();
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) {
      expectOnSheet(card, card.title);
      expect(cardLayout(card).clamped, card.title).toBe(false);
    }
  });

  it('keeps every seed project on the sheet, whole, with the design long title in its place', () => {
    for (const seed of seedProjects()) {
      const card = { ...seed, title: LONG_TITLE };
      expectOnSheet(card, seed.title);
      const layout = cardLayout(card);
      expect(layout.clamped, seed.title).toBe(false);
      // The title stands whole in the PROJECT cell and the column (no line ends cut short).
      expect(drawnText(card).join(' ')).not.toContain('\u2026');
    }
  });

  it('draws a card that fits at the designed type and width at them', () => {
    const card: ProjectCard = { kind: 'project', title: 'Test Rig', subtitle: 'A test subtitle', sheet: 1, sheets: 2, role: 'Test role', status: 'Test status', rev: '2026-11-16' };
    expect(cardLayout(card)).toMatchObject({ level: 0, leadSize: 26, clamped: false, block: { width: 456 } });
    expectOnSheet(card, 'short');
  });

  it('runs the title across the sheet when the text clears a short block', () => {
    const card: ProjectCard = { kind: 'project', title: 'Test Rig', sheet: 1, sheets: 1, status: 'Test status' };
    expect(cardLayout(card).text?.width).toBe(SHEET_AREAS.text.width);
    expectOnSheet(card, 'across');
  });

  it('steps the title block type down for a card with every field long, and cuts nothing', () => {
    const layout = cardLayout(WORST);
    expect(layout.level).toBeGreaterThan(0);
    expect(layout.block?.width).toBe(456);
    expect(layout.clamped).toBe(false);
    expectOnSheet(WORST, 'worst');
    expect(drawnText(WORST).join(' ')).not.toContain('\u2026');
  });

  it('widens the block only past its smallest type, narrowing the column beside it, and cuts nothing', () => {
    const layout = cardLayout(WIDER);
    expect(layout.block!.width).toBeGreaterThan(456);
    expect(layout.clamped).toBe(false);
    // The column ends a gap before the wider block.
    expect(layout.text!.left + layout.text!.width + SHEET_AREAS.gap).toBe(layout.block!.left);
    expectOnSheet(WIDER, 'wider');
  });

  it('steps a long title and subtitle down together to stay in the column', () => {
    const card: ProjectCard = { ...WORST, title: times(LONG_TITLE, 2), subtitle: times(WORST.subtitle!, 3) };
    expectOnSheet(card, 'long text');
    expect(cardLayout(card).clamped).toBe(false);
  });

  it('keeps content far past any real length on the sheet, cutting it short with an ellipsis, and every field keeps its cell', () => {
    expectOnSheet(ABSURD, 'absurd');
    expect(cardLayout(ABSURD).clamped).toBe(true);
    const drawn = drawnText(ABSURD);
    expect(drawn.some((s) => s.endsWith('\u2026'))).toBe(true);
    // No full stop or comma before the ellipsis.
    for (const s of drawn) expect(s).not.toMatch(/[.,;:]\u2026$/);
    // Each field the alt text names still has its cell: PROJECT, SHEET (whole), ROLE, DATES, STATUS, REV, MATURITY.
    expect(labels(ABSURD)).toEqual(['PROJECT', 'SHEET', 'ROLE', 'DATES', 'STATUS', 'REV', 'MATURITY']);
    expect(drawn).toContain(`12 ${UI.titleBlock.of.toUpperCase()} 12`);
    expect(drawn).toContain('2026-11-16');
  });
});

describe('the home image', () => {
  const home = (): HomeCard => siteHomeCard();

  it('draws the seed headline and name on the sheet, whole, at the designed type', () => {
    expectOnSheet(home(), 'home');
    expect(cardLayout(home())).toMatchObject({ level: 0, leadSize: 26, clamped: false });
  });

  it('steps a long headline down to stay above the title block', () => {
    const card = { ...home(), headline: times(home().headline!, 3) };
    expectOnSheet(card, 'long headline');
    expect(cardLayout(card).clamped).toBe(false);
  });

  it('keeps a headline and a name far past any real length on the sheet, cut short', () => {
    const card: HomeCard = { kind: 'home', headline: times(home().headline!, 20), name: times('A test name, not the owner: long enough', 12) };
    expectOnSheet(card, 'absurd home');
    expect(cardLayout(card).clamped).toBe(true);
    expect(labels(card)).toEqual(['NAME']);
  });
});
