import { describe, expect, it } from 'vitest';
import { findMatches, highlightsForPage, normalizeQuery, type PageText } from '../components/viewers/document/search';

/** A page of pdf.js text items: each item's string and whether a line ends after it. */
const page = (items: [string, boolean][]): PageText => ({ strs: items.map((i) => i[0]), eols: items.map((i) => i[1]) });

const pages = [
  page([['The word ', false], ['Viewer', false], [' is here.', true], ['', true], ['view', false], ['er again', true]]),
  page([['No match on this line', true], ['a.b*c (x)', true]]),
  page([['phrase that', true], ['wraps lines', true]]),
];

describe('PDF search', () => {
  it('normalizes the query: trimmed, one space for any run of white space', () => {
    expect(normalizeQuery('  two   words \n')).toBe('two words');
  });

  it('ignores case and finds a match split across two text items', () => {
    const matches = findMatches(pages, 'viewer');
    expect(matches).toEqual([
      { page: 1, ranges: [{ item: 1, start: 0, end: 6 }] },
      {
        page: 1,
        ranges: [
          { item: 4, start: 0, end: 4 },
          { item: 5, start: 0, end: 2 },
        ],
      },
    ]);
  });

  it('treats regular-expression characters literally', () => {
    expect(findMatches(pages, 'a.b*c (x)').map((m) => m.page)).toEqual([2]);
    expect(findMatches(pages, 'a.b')).toHaveLength(1);
    expect(findMatches(pages, '.*')).toHaveLength(0);
  });

  it('finds a phrase across a line end, whatever white space the query holds', () => {
    expect(findMatches(pages, 'that   wraps')).toEqual([
      {
        page: 3,
        ranges: [
          { item: 0, start: 7, end: 11 },
          { item: 1, start: 0, end: 5 },
        ],
      },
    ]);
  });

  it('finds nothing for a blank query and stops at the limit', () => {
    expect(findMatches(pages, '   ')).toHaveLength(0);
    expect(findMatches(pages, 'e', 3)).toHaveLength(3);
  });

  it('groups one page of highlights by item and flags the current match', () => {
    const all = findMatches(pages, 'viewer');
    const highlights = highlightsForPage(all, 1, 1);
    expect(highlights.get(1)).toEqual([{ start: 0, end: 6, current: false }]);
    expect(highlights.get(4)).toEqual([{ start: 0, end: 4, current: true }]);
    expect(highlights.get(5)).toEqual([{ start: 0, end: 2, current: true }]);
    expect(highlightsForPage(all, 2, 0).size).toBe(0);
  });
});
