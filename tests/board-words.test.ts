// @vitest-environment jsdom
/**
 * Interface words the page boards give, where the site had its own (the Phase 7 audit; the canvas's
 * Site.dc.html and the design bundle): the line under the /projects heading and the filter's count,
 * the contact page's copy button, the word its status says, and the name of its other links, and
 * the revision table's name for screen readers. The 404 line is in not-found.test.ts.
 */
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RevisionTable from '../components/sheet/RevisionTable';
import { makeLinkResolver } from '../lib/links';
import { UI } from '../lib/strings';

vi.mock('next/navigation', async (load) => ({
  ...(await load<typeof import('next/navigation')>()),
  usePathname: () => '/projects',
  useRouter: () => ({ push: () => undefined, back: () => undefined }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.unstubAllGlobals();
});

describe('the projects page', () => {
  it("says the board's line under its heading, and counts as the board does", async () => {
    const { default: ProjectsPage } = await import('../app/(site)/projects/page');
    const { siteData } = await import('../lib/site');
    const html = renderToStaticMarkup(ProjectsPage());
    expect(UI.projects.line).toBe('Every project in sheet order. Filter by domain.');
    expect(html).toContain(`<p class="pj-sub">${UI.projects.line}</p>`);
    expect(UI.projects.count(6, 12)).toBe('6 of 12 projects');
    const total = siteData().projects.length;
    expect(html).toContain(UI.projects.count(total, total));
    expect(html).not.toContain('Showing ');
  }, 120_000);
});

describe('the contact page', () => {
  it('names the copy button and the other links in the board\'s words, and says "Copied"', async () => {
    const { default: ContactPage } = await import('../app/(site)/contact/page');
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    act(() => root!.render(h(ContactPage)));

    const button = host.querySelector<HTMLButtonElement>('button.ar-iconbtn');
    expect(button?.getAttribute('aria-label')).toBe('Copy the email address');
    expect(button?.getAttribute('title')).toBe(UI.contact.copyEmail);
    expect(host.querySelector('ul.st-links')?.getAttribute('aria-label')).toBe('Other ways to reach me');

    await act(async () => button!.click());
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(host.querySelector('.st-copied')?.textContent).toBe('Copied');
  }, 120_000);
});

describe('the revision table', () => {
  it("is named as the bundle names it, for screen readers", () => {
    const resolve = makeLinkResolver(new Set(['raven']), { siteHosts: ['amjadrehawi.com'], phoneShown: true });
    const html = renderToStaticMarkup(
      h(RevisionTable, { rows: [{ key: 'a', date: '2026-02', title: 'Project start', md: '', media: [] }], resolveLink: resolve, anchorPrefix: 'r-' }),
    );
    expect(html).toContain('<caption class="ar-sr">Build log, newest first</caption>');
  });
});
