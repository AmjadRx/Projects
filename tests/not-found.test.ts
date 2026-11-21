/**
 * "Sheet not found" (ARCHITECTURE.md 5; the NotFound boards): the empty drawing well with its line,
 * the heading, the board's line under it, and the two ways on, projects first.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { UI } from '../lib/strings';

vi.mock('next/navigation', async (load) => ({
  ...(await load<typeof import('next/navigation')>()),
  usePathname: () => '/no-such-page',
  useRouter: () => ({ push: () => undefined, back: () => undefined }),
}));

describe('the not-found page', () => {
  it('draws the NotFound board: the well, the heading, its line, then projects and home', async () => {
    const { default: NotFound } = await import('../app/not-found');
    const html = renderToStaticMarkup(NotFound());
    const main = /<main\b[^>]*>([\s\S]*)<\/main>/.exec(html)?.[1] ?? '';
    expect(UI.notFound.heading).toBe('Sheet not found');
    expect(UI.notFound.line).toBe('There is no sheet at this address.');
    const order = [UI.notFound.well, `<h1 class="st-title">${UI.notFound.heading}</h1>`, `<p class="st-sub">${UI.notFound.line}</p>`, 'href="/projects"', 'href="/"'];
    let from = 0;
    for (const part of order) {
      const at = main.indexOf(part, from);
      expect(at, part).toBeGreaterThan(-1);
      from = at + part.length;
    }
  }, 120_000);
});
