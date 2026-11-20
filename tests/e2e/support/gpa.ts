/**
 * The GPA rule (ARCHITECTURE.md 4 and 15, item 2; CONTENT_RULES.md; CLAUDE.md, Site content): the
 * only GPA is the major GPA, always printed exactly as its label and value together, "Major GPA
 * 3.65": the value never appears without its label, nothing extends the value (3.654, 3.650, a
 * scale such as /4.0 or "out of 4"), "overall" never names it, and the word "cumulative" never sits
 * beside it.
 */
import type { Page } from '@playwright/test';

/** The only form the GPA may take, and the label that must come right before the value. */
export const GPA = 'Major GPA 3.65';
const LABEL = 'Major GPA ';
const VALUE = '3.65';

export interface TextSource {
  /** Where the text was found ("visible text", "meta description", "JSON-LD", ...). */
  source: string;
  text: string;
}

/**
 * Every place on the page where the rule applies, with white space collapsed: the visible text
 * (innerText of the body), the title, every meta tag's content, every string in the JSON-LD, and
 * the accessible names written as attributes (alt, aria-label, title).
 */
export function gpaSources(page: Page): Promise<TextSource[]> {
  return page.evaluate(() => {
    const squash = (text: string) => text.replace(/\s+/g, ' ').trim();
    const sources: { source: string; text: string }[] = [
      { source: 'visible text', text: squash(document.body.innerText) },
      { source: 'title', text: squash(document.title) },
    ];
    for (const meta of Array.from(document.querySelectorAll('meta[content]'))) {
      const name = meta.getAttribute('name') ?? meta.getAttribute('property') ?? meta.getAttribute('itemprop') ?? 'meta';
      sources.push({ source: `meta ${name}`, text: squash(meta.getAttribute('content') ?? '') });
    }
    const strings = (value: unknown): string[] => {
      if (typeof value === 'string') return [value];
      if (Array.isArray(value)) return value.flatMap(strings);
      if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
      return [];
    };
    for (const script of Array.from(document.querySelectorAll('script[type="application/ld+json"]'))) {
      let data: unknown = null;
      try {
        data = JSON.parse(script.textContent ?? '');
      } catch {
        sources.push({ source: 'JSON-LD (not valid JSON)', text: squash(script.textContent ?? '') });
        continue;
      }
      for (const text of strings(data)) sources.push({ source: 'JSON-LD', text: squash(text) });
    }
    for (const element of Array.from(document.querySelectorAll('[alt], [aria-label], [title]'))) {
      for (const attribute of ['alt', 'aria-label', 'title']) {
        const value = element.getAttribute(attribute);
        if (value) sources.push({ source: `${attribute} of ${element.tagName.toLowerCase()}`, text: squash(value) });
      }
    }
    return sources;
  });
}

/** What may not follow the value: more digits, a decimal, or a scale (3.654, 3.650, 3.65/4.0, 3.65 out of 4). */
const EXTENDED = /^(?:\d|\.\d|\s*\/\s*\d|\s+(?:out\s+)?of\s+\d)/i;
/**
 * A word right before the label that makes it the whole GPA rather than the major one. Only these
 * two: the visible text runs a list's fields together, and a field before the GPA may well end in
 * a word such as "quarter" or "term".
 */
const QUALIFIED = /\b(?:overall|cumulative)\s*$/i;

/** Each place in a text where the GPA breaks the rule, quoted with a little of what is around it. */
export function gpaProblems({ source, text }: TextSource): string[] {
  const problems: string[] = [];
  const quote = (at: number) => `"${text.slice(Math.max(0, at - 40), at + 40)}"`;
  const gpaAt = GPA.indexOf('GPA');
  for (const match of text.matchAll(/gpa/gi)) {
    const at = match.index ?? 0;
    const start = at - gpaAt;
    if (start < 0 || text.slice(start, start + GPA.length) !== GPA) problems.push(`${source}: GPA not as "${GPA}": ${quote(at)}`);
    else if (EXTENDED.test(text.slice(start + GPA.length))) problems.push(`${source}: more than "${GPA}" (the value goes on): ${quote(at)}`);
    else if (QUALIFIED.test(text.slice(Math.max(0, start - 20), start))) problems.push(`${source}: "${GPA}" named as another GPA: ${quote(at)}`);
  }
  for (const match of text.matchAll(new RegExp(VALUE.replace('.', '\\.'), 'g'))) {
    const at = match.index ?? 0;
    if (at < LABEL.length || text.slice(at - LABEL.length, at) !== LABEL) problems.push(`${source}: ${VALUE} without its label: ${quote(at)}`);
  }
  for (const match of text.matchAll(/cumulative/gi)) {
    const at = match.index ?? 0;
    if (/gpa/i.test(text.slice(Math.max(0, at - 40), at + 50))) problems.push(`${source}: "cumulative" beside the GPA: ${quote(at)}`);
  }
  return problems;
}
