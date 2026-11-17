/**
 * Search inside a PDF's text, and the highlights drawn in pdf.js's text layer.
 *
 * Pure functions plus one DOM helper. The text comes from `page.getTextContent()`, so an item
 * index here is the same index pdf.js uses for that page. Matching ignores case and treats any
 * run of spaces or line ends as one space, so a phrase that wraps onto the next line still
 * matches. Highlights are built with DOM nodes, never with an HTML string: the text inside a PDF
 * is untrusted.
 */

/** One page's text: every item's string ("" for items with no text) and its end-of-line flag. */
export interface PageText {
  strs: string[];
  eols: boolean[];
}

/** A run of characters inside one text item: `start` to `end`, end excluded. */
export interface TextRange {
  item: number;
  start: number;
  end: number;
}

/** One match: its page (from 1) and the item ranges it covers, in reading order. */
export interface SearchMatch {
  page: number;
  ranges: TextRange[];
}

/** Searching stops after this many matches, so a one-letter query stays fast. */
export const MAX_MATCHES = 2000;

/** Trims the query and turns every run of white space into one space. */
export function normalizeQuery(query: string): string {
  return query.trim().replace(/\s+/g, ' ');
}

/** Lower case, one UTF-16 unit at a time, so positions in the folded text match the source. */
function foldChar(ch: string): string {
  const lower = ch.toLowerCase();
  return lower.length === 1 ? lower : ch;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The pattern for a normalized query: case folded, and any white space matches any run of it. */
function patternFor(query: string): RegExp | null {
  const folded = Array.from(normalizeQuery(query), foldChar).join('');
  if (folded === '' || folded === ' ') return null;
  const source = folded
    .split(' ')
    .map(escapeRegExp)
    .join('\\s+');
  return new RegExp(source, 'g');
}

/**
 * Builds one page's searchable text. `owner[i]` and `offset[i]` say which item and which
 * character of it produced character i; a line end adds a space that belongs to no item (-1).
 */
function pageIndex(page: PageText): { text: string; owner: Int32Array; offset: Int32Array } {
  let length = 0;
  for (let i = 0; i < page.strs.length; i += 1) length += page.strs[i].length + (page.eols[i] ? 1 : 0);
  const owner = new Int32Array(length);
  const offset = new Int32Array(length);
  const parts: string[] = [];
  let at = 0;
  for (let i = 0; i < page.strs.length; i += 1) {
    const str = page.strs[i];
    for (let c = 0; c < str.length; c += 1) {
      parts.push(foldChar(str[c]));
      owner[at] = i;
      offset[at] = c;
      at += 1;
    }
    if (page.eols[i]) {
      parts.push(' ');
      owner[at] = -1;
      offset[at] = -1;
      at += 1;
    }
  }
  return { text: parts.join(''), owner, offset };
}

/** Item ranges covered by characters `from` to `to` (end excluded) of a page index. */
function rangesFor(owner: Int32Array, offset: Int32Array, from: number, to: number): TextRange[] {
  const ranges: TextRange[] = [];
  for (let i = from; i < to; i += 1) {
    const item = owner[i];
    if (item < 0) continue;
    const last = ranges[ranges.length - 1];
    if (last && last.item === item && last.end === offset[i]) last.end += 1;
    else ranges.push({ item, start: offset[i], end: offset[i] + 1 });
  }
  return ranges;
}

/** Every match of `query` in `pages` (page 1 first), up to `limit`. */
export function findMatches(pages: PageText[], query: string, limit = MAX_MATCHES): SearchMatch[] {
  const pattern = patternFor(query);
  if (!pattern) return [];
  const matches: SearchMatch[] = [];
  for (let p = 0; p < pages.length && matches.length < limit; p += 1) {
    const { text, owner, offset } = pageIndex(pages[p]);
    pattern.lastIndex = 0;
    let found: RegExpExecArray | null;
    while ((found = pattern.exec(text)) !== null && matches.length < limit) {
      const end = found.index + found[0].length;
      if (end === found.index) {
        pattern.lastIndex += 1;
        continue;
      }
      const ranges = rangesFor(owner, offset, found.index, end);
      if (ranges.length > 0) matches.push({ page: p + 1, ranges });
    }
  }
  return matches;
}

export interface ItemHighlight {
  start: number;
  end: number;
  current: boolean;
}

/** The highlights on one page, grouped by item and sorted by position. */
export function highlightsForPage(matches: readonly SearchMatch[], page: number, current: number): Map<number, ItemHighlight[]> {
  const byItem = new Map<number, ItemHighlight[]>();
  matches.forEach((match, index) => {
    if (match.page !== page) return;
    for (const range of match.ranges) {
      const list = byItem.get(range.item) ?? [];
      list.push({ start: range.start, end: range.end, current: index === current });
      byItem.set(range.item, list);
    }
  });
  byItem.forEach((list) => list.sort((a, b) => a.start - b.start));
  return byItem;
}

/**
 * Draws the highlights into a rendered pdf.js text layer and returns the current match's first
 * mark, if it is on this page.
 *
 * pdf.js draws one `span[role="presentation"]` per item with text, in item order, so the k-th
 * such span belongs to the k-th item whose string is not empty. A span whose text differs from
 * its item is never touched: if the two ever disagree, the page simply shows no highlights.
 */
export function applyHighlights(
  layer: HTMLElement,
  page: PageText,
  byItem: Map<number, ItemHighlight[]>,
  classes: { match: string; current: string },
): HTMLElement | null {
  const spans = layer.querySelectorAll<HTMLElement>('span[role="presentation"]');
  let k = 0;
  let currentMark: HTMLElement | null = null;
  for (let i = 0; i < page.strs.length; i += 1) {
    const str = page.strs[i];
    if (str === '') continue;
    const span = spans[k];
    k += 1;
    if (!span) break;
    if (span.textContent !== str) return currentMark;
    const highlights = byItem.get(i);
    const marked = span.dataset.highlighted === 'true';
    if (!highlights && !marked) continue;

    const fragment = document.createDocumentFragment();
    let at = 0;
    for (const highlight of highlights ?? []) {
      const start = Math.max(at, Math.min(highlight.start, str.length));
      const end = Math.min(highlight.end, str.length);
      if (end <= start) continue;
      if (start > at) fragment.append(str.slice(at, start));
      const mark = document.createElement('mark');
      mark.className = highlight.current ? `${classes.match} ${classes.current}` : classes.match;
      mark.textContent = str.slice(start, end);
      if (highlight.current) {
        mark.dataset.current = 'true';
        currentMark ??= mark;
      }
      fragment.append(mark);
      at = end;
    }
    if (at < str.length) fragment.append(str.slice(at));
    span.replaceChildren(fragment);
    if (highlights) span.dataset.highlighted = 'true';
    else delete span.dataset.highlighted;
  }
  return currentMark;
}
