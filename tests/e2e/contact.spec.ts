/**
 * The contact page (ARCHITECTURE.md 15, item 6c): it shows the email, LinkedIn, GitHub, "Book a
 * call", the phone number, and a "Request my resume" button that is an email link; and no resume
 * file is linked or served anywhere on the site (ARCHITECTURE.md 4: "No resume file is ever served
 * by the site").
 */
import fs from 'node:fs';
import path from 'node:path';
import { UI } from '../../lib/strings';
import { expect, test } from './support/fixtures';
import { open } from './support/page';
import { namedLikeResume } from './support/resume';
import { DESKTOP, device, routeTitle, ROUTES, site } from './support/site';

const email = site.personal.email.trim();
const phone = site.personal.phone.trim();
const digits = (text: string) => text.replace(/\D/g, '');

/**
 * The links of a page that lead to a resume file or page (./support/resume.ts): anything but an
 * email or a phone link, and Next's own built files, named like one.
 */
function resumeLinks(hrefs: string[]): string[] {
  return hrefs.filter((href) => {
    if (/^(mailto|tel):/i.test(href) || href.startsWith('/_next/')) return false;
    return namedLikeResume(href.split(/[?#]/)[0]);
  });
}

/** Every href in a page's HTML. */
function hrefsIn(html: string): string[] {
  return [...html.matchAll(/\shref="([^"]*)"/g)].map((match) => match[1].replace(/&amp;/g, '&'));
}

/** Files under a folder, relative to it. */
function filesUnder(folder: string): string[] {
  if (!fs.existsSync(folder)) return [];
  return fs.readdirSync(folder, { withFileTypes: true, recursive: true }).flatMap((entry) =>
    entry.isFile() ? [path.relative(folder, path.join(entry.parentPath, entry.name))] : [],
  );
}

test.describe('contact page', () => {
  test.use(device(DESKTOP));

  test.beforeEach(async ({ page }) => {
    expect(await open(page, '/contact'), 'status').toBe(200);
  });

  test('shows the email address, with an "Email me" link to it', async ({ page }) => {
    const main = page.locator('main');
    await expect(main.getByText(email, { exact: true }).first()).toBeVisible();
    await expect(main.getByRole('link', { name: UI.contact.emailMe, exact: true })).toHaveAttribute('href', `mailto:${email}`);
  });

  test('links LinkedIn', async ({ page }) => {
    const link = page.locator('main').getByRole('link', { name: 'LinkedIn', exact: true });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', /^https:\/\/([a-z]+\.)?linkedin\.com\/in\//);
  });

  test('links GitHub', async ({ page }) => {
    const link = page.locator('main').getByRole('link', { name: 'GitHub', exact: true });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', /^https:\/\/github\.com\/[^/]+\/?$/);
  });

  test('links "Book a call"', async ({ page }) => {
    const link = page.locator('main').getByRole('link', { name: 'Book a call', exact: true });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', /^https:\/\//);
  });

  test('shows the phone number as a phone link', async ({ page }) => {
    expect(phone, 'the content has a phone number').not.toBe('');
    const link = page.locator('main').getByRole('link', { name: phone, exact: true });
    await expect(link).toBeVisible();
    const href = (await link.getAttribute('href')) ?? '';
    expect(href).toMatch(/^tel:\+?\d+$/);
    expect(digits(href).endsWith(digits(phone)), `${href} dials ${phone}`).toBe(true);
  });

  test('"Request my resume" is a button that opens an email to the owner', async ({ page }) => {
    const request = site.contact.resumeRequest;
    const link = page.locator('main').getByRole('link', { name: 'Request my resume', exact: true });
    await expect(link).toBeVisible();
    await expect(link, 'drawn as a button').toHaveClass(/(^|\s)ar-btn(\s|$)/);
    const href = (await link.getAttribute('href')) ?? '';
    const url = new URL(href);
    expect(url.protocol).toBe('mailto:');
    expect(decodeURIComponent(url.pathname)).toBe(email);
    expect(url.searchParams.get('subject')).toBe(request?.subject ?? '');
    expect(url.searchParams.get('body')).toBe(request?.body ?? '');
  });

  test('links no resume file, and the server serves none', async ({ page, request }) => {
    const hrefs = await page.locator('a[href]').evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));
    expect(resumeLinks(hrefs), 'links to a resume').toEqual([]);
    const documents = hrefs.filter((href) => /\.(pdf|docx?|rtf|odt|pages)([?#]|$)/i.test(href));
    expect(documents, 'links to a document file on the contact page').toEqual([]);
    for (const address of ['/resume', '/resume.pdf', '/Resume.pdf', '/cv', '/cv.pdf', '/media/site/resume.pdf', '/media/resume.pdf']) {
      expect((await request.get(address)).status(), address).toBe(404);
    }
    // The files the server serves as they are, /media (the admin's uploads) among them, with the folders they sit in.
    const publicFiles = filesUnder(path.join(__dirname, '..', '..', 'public')).map((file) => file.split(path.sep).join('/'));
    expect(publicFiles.filter(namedLikeResume), 'files in public/ named like a resume').toEqual([]);
  });
});

test('no page links a resume file', async ({ request }) => {
  const found: string[] = [];
  for (const route of ROUTES) {
    const response = await request.get(route.path);
    expect(response.status(), routeTitle(route)).toBe(route.status);
    for (const href of resumeLinks(hrefsIn(await response.text()))) found.push(`${routeTitle(route)}: ${href}`);
  }
  expect(found).toEqual([]);
});
