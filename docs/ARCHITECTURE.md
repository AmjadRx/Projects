# Architecture

A short public summary of how this site is built. It is a static portfolio drawn as an
engineering drawing sheet, with an admin that edits the content through git.

## Stack

- Next.js 14.2 (App Router), React 18, TypeScript, and Tailwind CSS 3 over design tokens in
  `app/tokens.css`, in two themes: Blueprint (dark) and Whiteprint (light).
- Content as JSON validated by a zod schema; Motion and Motion+ for animation; three.js for the
  sky and the 3D model viewer.
- Hosted on Vercel. GitHub holds the code and the content; Vercel Blob holds media files over
  4 MB.
- A framework upgrade (Next.js 16, React 19, Tailwind CSS 4) is planned and has not run yet.

## Repository layout

| folder | what it holds |
|---|---|
| `app/` | Routes: the public pages in the `(site)` group, `/admin`, the API routes, metadata, the sitemap, robots, the icons, and the generated share images. |
| `components/` | The drawing-sheet design system (`sheet/`), the site chrome, the home page, the command palette, the viewers (image, video, audio, document, 3D model), the sky, and the admin. |
| `lib/` | Loading and validating content, the content rules, the motion numbers (`lib/motion.ts`), the theme, metadata and structured data, the share-image renderer (`lib/og/`), and the media helpers. |
| `content/` | `site.json` and one file per project: every word the site shows. |
| `public/` | Media files, and the sky's star data and still images. |
| `scripts/` | The checks (content, secrets, lockfile, sky), the Lighthouse CI runner, and the build helpers. |
| `tests/` | Unit tests, build tests, and the end-to-end and accessibility suite (`tests/e2e/`). |
| `docs/` | These summaries, the rebuild plan, and the acceptance report. |
| `.github/` | The CI workflow. |

## Content

`content/site.json` holds the site-wide settings, the home page, about, experience, and contact;
each project is one file with its title block, pitch, highlights, and an ordered list of blocks
(text, images, galleries, video, audio, documents, 3D models, roadmaps, logs, and more). A project
with `visible: false`, and any empty field, leaves no trace anywhere: pages, links, metadata,
structured data, the sitemap, the palette's index, or the share images.

## Pages

`/`, `/projects`, `/projects/[slug]`, `/about`, `/experience`, `/log` (every log entry from every
visible project, newest first), `/contact`, and a "Sheet not found" page. Every public page is
static. Also:

- **The command palette.** Ctrl or Cmd with K, or the search button in the nav, opens a search
  over the pages, the visible projects, and each project's sections. It is keyboard first, keeps
  focus inside while open, and closes on Escape. Its code and index load only when needed.
- **Print.** A project page prints as one landscape drawing sheet on white: the frame, the title,
  the cover with its dimensions, the notes, the tables, and the title block. Other pages print
  plainly on white, without the nav, the sky, controls, or motion.
- **Share images.** Generated at build time in the sheet style for the home page and for each
  project, from the site's own fonts.
- **Search engines.** Per-page titles, descriptions, canonical addresses, and Open Graph and
  Twitter cards; JSON-LD with `Person` on the home page and `CreativeWork` on each project, built
  only from fields the page shows; a sitemap of the visible pages; icons and a web manifest. The
  admin and the development pages carry `noindex`.

## The hero and the sky

The home page's hero shows one of three things, chosen in the admin: a line drawing of Raven, the
owner's aircraft project, with a thermal lens that follows the pointer; the owner's photo or video;
or the owner's 3D model. Behind every page is a sky drawn from a real star catalog and a real Milky
Way image, as seen over Santa Clara. It runs in three tiers (full, light, and a still image),
steps down by itself when the frame rate drops, and stops when the tab is hidden or idle. The
still image is what every page paints first; the live sky loads after the page is interactive.

## Motion

Motion follows the design's motion sheets. Under reduced motion, or with the footer's "Pause
motion" control, nothing moves by itself and no content is lost.

## The admin

`/admin` edits all content and media. A save is one commit on a draft branch, Vercel builds a
preview of it, and Publish fast-forwards the live branch to the draft. Every save and every build
runs the content check. See `docs/ADMIN_GUIDE.md`.

## Budgets

| measure | budget |
|---|---|
| Largest Contentful Paint (phone, 4G) | under 2.0 s |
| Cumulative Layout Shift | under 0.02 |
| Interaction to Next Paint | under 150 ms (in the lab, Total Blocking Time stands in for it) |
| Home page JavaScript, first load, compressed | under 160 kB, with no three.js or viewer code |
| The sky's deferred chunk, compressed | under 220 kB |
| Lighthouse, both themes, phone and desktop | Performance 95, Accessibility 100, Best Practices 100, SEO 100 |

`npm run lighthouse` measures every public page against these on a production build, and the
build itself fails when the first load or the sky's chunk passes its budget.

## Accessibility

WCAG 2.2 AA: landmarks, one heading 1 per page, every function by keyboard, visible focus, focus
trapped only in the menu, the lightbox, and the command palette (each closes with Escape), and
44 px targets. Decorative motion is hidden from assistive technology. axe runs on every route in
both themes, and text over the sky is checked for contrast from screenshots.

## Security

- Secrets live only in environment variables, never in the repository. The admin has no fallback
  credentials.
- Sign-in is rate limited; sessions are signed, http-only, secure, same-site cookies.
- Routes that change data check the session, the request's origin, and the body's shape.
- Uploads are checked by their bytes, not their names; SVG files are cleaned; models and
  documents are parsed with size and time limits.
- A Content Security Policy without `unsafe-eval`, no framing, HSTS, and a strict referrer and
  permissions policy. Embeds come only from YouTube and Vimeo.
- Tracked files and the build output are scanned for secrets.

## Checks

Before each commit: the content check and the lockfile check. In CI, on every push to `v3` and
every pull request to `main`: lint, types, unit tests, the content check, the production build with
its weight and secret checks, the build tests, Lighthouse CI against the budgets above, the
end-to-end and axe suite, and a secret scan of the new commits.
