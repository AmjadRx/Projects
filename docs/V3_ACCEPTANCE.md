# v3 acceptance report

The acceptance list of `ARCHITECTURE.md` section 15 (in the owner's handoff), run once, item by item, at the end of Phase 7 on 2026-11-20.

- **Code measured:** `v3` at `a054a99`.
- **Local runs:** a production build of that commit served by `next start` on the owner's Windows computer (Node 24.19.0, Google Chrome with a GPU), on mains power, with the machine otherwise quiet.
- **Preview:** the Vercel preview deployment of that commit (`dpl_CWAX2iWSFnnsVgiUqEJQVyyqUUTu`, branch alias `personalsite-git-v3-amjadrxs-projects.vercel.app`), reached through a share link that expires on its own and is written nowhere.
- **The commit after the run** adds this report and the documentation only; it changes no page code.

## Summary

| item | what it asks | result |
|---|---|---|
| 1 | Only the seed's content; `npm run check:content` passes | Pass |
| 2 | The GPA only as "Major GPA 3.65"; hidden or emptied fields leave no trace | Pass |
| 3 | AA contrast in both themes; the theme persists without a flash | Pass, with a design deviation for the owner to confirm |
| 4 | 390, 768, 1024 and 1440 px with no horizontal scroll | Pass |
| 5 | The thermal ramp only in its eight places | Pass |
| 6 | The hero in all three modes; no three.js in any first load | Pass |
| 6a | The sky's tiers, demotion, pause, touch, text over it, credits | Pass |
| 6b | Every attachment kind: upload, library, poster, viewer, download, text alternative; STEP | Partial: Word files have no poster, and models have no download link |
| 6c | The contact page's links and the resume request; no resume file | Pass |
| 7 | Reduced motion removes all animation and loses no content | Pass |
| 8 | Every block type renders; an unknown one renders nothing | Pass |
| 9 | The admin's full cycle | Pass, from the Phase 6 run on the preview; Phase 7 changed no admin code |
| 10 | A forbidden pattern is refused with its rule id and field | Pass |
| 11 | 503 without the password, 401, the lockout, no secret in the bundle | Pass |
| 12 | The budgets of section 9 on the preview deployment | Fail on 13 of 72 page and configuration pairs: the phone's LCP on the cover-photo pages (medians 2.13 to 2.88 s against 2.0 s); every other budget passes |
| 13 | axe: no violation on any route in either theme | Pass |
| 14 | `main` untouched; the pull request open | `main` untouched; the pull request is opened after this report |

The local runs behind several items: the unit tests (107 files, 1,936 tests, all passed); `tsc`, `next lint` and `next lint --dir tests` (clean); the build tests (`npm run test:build`: 2 files, 31 tests, all passed, each on a full production build); and the whole end-to-end suite on the production build (837 tests in 7.7 minutes, 836 passed). The one failure was a self-test of the suite's own image check, which caught its deliberately dropped request too late once under full load and passed 15 of 15 when run again; it is `docs/V3_FOLLOWUPS.md` 39. Each spec, passed of run: axe 76 of 76, console 95 of 95, contact 8 of 8, contrast 152 of 152, gpa 19 of 19, harness 23 of 24, keyboard 100 of 100, layout 152 of 152, not found 2 of 2, palette 15 of 15, print 31 of 31, reduced motion 81 of 81, sky 3 of 3, theme 79 of 79.

## The items

### 1. Only the seed's content

**Pass.** On the Vercel build of `a054a99`, with the private blocklist set, the content check reported: 18 files (content and docs), 411 interface files, 628 files scanned for dashes, 40 public rules, 17 private terms checked, 0 errors and 0 warnings; the build would have stopped on any error. The same check passes locally (the private terms are not set on this computer). The unit tests prove every seed file validates and passes the public rules with every proof resolving, and the build tests' fidelity test checks every content string on its page, in order; it passed. The not-found spec passes 2 of 2.

### 2. The GPA, and no trace of hidden or emptied fields

**Pass.** The end-to-end GPA spec (19 of 19) finds the GPA only as "Major GPA 3.65" in the text, the title, the meta tags and the JSON-LD of every route. The build tests' hiding test builds a fixture with a hidden project, links to it from every kind of link field, and emptied fields (GPA, phone, description, cover, photo), and searches every output file, the sitemap and the Open Graph images for traces; it passed. Unit tests cover the same rules for the sitemap, the metadata, the palette's index and the share images.

### 3. AA contrast in both themes, and the theme without a flash

**Pass.** axe (every WCAG 2.0, 2.1 and 2.2 A and AA rule) finds no violation on any route in either theme, locally (76 of 76) and on the preview (item 13). Contrast over the sky and the glass, which axe leaves undecided, is measured from screenshots in which the text is painted transparent: 152 of 152 pass, every route, both themes, at 390, 768, 1024 and 1440 px, from the top of each page to its end, with 0 failures and no text left unjudged. The lowest ratios: Whiteprint 5.15 to 1 at every width; Blueprint 4.68 at 768 px, 4.72 at 1024 px and 4.52 at 1440 px, and at 390 px every text passes over every real hour of the sky. The nav's words over a white photo went from 3.63 to 1 (the "Ctrl K" hint 2.31) to 4.72, through a stronger dim on the nav's glass: a design deviation for the owner to confirm (`docs/V3_FOLLOWUPS.md` 27). A unit test checks the token pairs in both themes. The theme spec (79 of 79) shows the theme set from the first parse with no flash, kept across pages and visits.

### 4. No horizontal scroll from 390 to 1440 px

**Pass.** The layout spec, 152 of 152: every route, both themes, at 390, 768, 1024 and 1440 px, counting content the frame's clip would cut off.

### 5. The thermal ramp in its eight places only

**Pass.** `tests/thermal-ramp.test.ts` finds every use of the ramp in the stylesheets and the code and pins each to one of the eight places of `DESIGN_DIRECTION.md` 2.4 (the hero lens, the maturity scale, the heat rule, the roadmap, the primary button's sweep, the share images, the dawn, the model viewer's thermal view); it fails on any other use and on a listed use that is gone. The print spec confirms paper shows the ramp only in the maturity scale.

### 6. The hero's three modes, and no three.js in a first load

**Pass.** The hero tests render the drawing mode, the model mode with and without a model file, and the media mode with a photo, a video and the placeholder; a media hero whose photo or poster fails gives its slot to the drawing. On the Vercel build: "No three.js or live scene in 51 first-load chunks". The model and media modes have not been seen with the owner's own files, which are not uploaded yet (the seed is in drawing mode).

### 6a. The sky

**Pass.** On this computer's GPU the sky spec (3 of 3) shows the sky stepping from Full to Light to Still when frames slow down, the frame loop stopping in a hidden tab, and a finger dragged over the sky scrolling the page with no touch event cancelled; unit tests cover the 30-second idle stop, the tier choice and the demotion rules. Text over the sky passes AA (item 3). The star catalogue and the Milky Way image carry their credits in `public/sky/CREDITS.md` and the footer's credit line. Not tried: a real phone's GPU, Safari and Firefox (`docs/V3_FOLLOWUPS.md` 16).

### 6b. Attachments of every kind

**Partial.** The admin's preview test of 2026-11-19 uploaded a photo, a video, a PDF and a STEP model (converted to a GLB with its poster), sent a 5.3 MB file through Vercel Blob, and deleted them; unit tests cover the type check from the bytes, every conversion, the posters, both storage backends and the media library; the block tests render every viewer, each with its download row and text alternative, and the keyboard spec drives the lightbox. Not met: a Word file gets no poster, because Word files are never rendered in the site's own origin (D-28; `docs/V3_FOLLOWUPS.md` 9), and 3D models are not offered for download until the owner answers Q-24 (`docs/V3_FOLLOWUPS.md` 10).

### 6c. The contact page

**Pass.** The contact spec (8 of 8) finds the email, LinkedIn, GitHub, "Book a call" and the phone number, and a "Request my resume" button that opens an email to the owner; no resume file is served. The fidelity test checks their order.

### 7. Reduced motion

**Pass.** The reduced-motion spec, 81 of 81: on every route at the phone's and the desktop's width, no animation runs and no frame loop goes on at rest anywhere down the page, and the page holds the same text as with motion on; with the page open, the footer's pause control swaps each moving strip for its still one in place, with no layout shift.

### 8. Every block type, and an unknown one

**Pass.** `tests/block-types.test.ts` renders all 21 block types, and an unknown type renders nothing, alone, between known blocks and inside two columns; the fidelity test renders every project page's blocks in order.

### 9. The admin's full cycle

**Pass, from the Phase 6 run.** On 2026-11-19, on the v3 preview with the sandbox branches, the owner signed in and the cycle ran: the status panel, a project edited with two blocks added and reordered, uploads and deletes of each kind of file, a save to the draft, the draft's preview, a discard, and the owner's Publish (a fast-forward of the sandbox branch). The unit tests, against an in-memory GitHub, cover creating, duplicating, reordering, hiding and deleting a project (with the references to it), editing every block type, the site tabs' fields, and the save, publish and discard rules. Phase 7 changed no admin code: the diff from `e6aa2f1` to `a054a99` over `lib/admin`, `components/admin`, `app/admin` and `app/api` is empty. The cycle was not run again on this preview, since it needs the owner's sign-in.

### 10. A forbidden pattern

**Pass.** The admin's save tests refuse a forbidden public pattern with the rule id, the file and the exact field path, and a private term with its field and rule but never the term. On the Phase 6 preview a forbidden phrase typed into a field was refused the same way.

### 11. 503, 401, the lockout, and the bundle

**Pass.** Every route under `app/api` answers 503 naming the missing variable without `ADMIN_PASSWORD` or `SESSION_SECRET`, 401 without a session, and 403 to a foreign origin on every method that changes data; a wrong password answers 401, and the sixth wrong password locks the address out (unit tests). On the Vercel build the build-output scan found no secret in 243 files (5 secret variables and 13 private terms checked).

### 12. The budgets on the preview deployment

**Fail, on one budget for one kind of page: the phone's Largest Contentful Paint of the pages whose largest paint is the cover photo.** Lighthouse 13.6.0, with its default phone and desktop profiles and simulated throttling, on all 18 public pages of the preview in both themes, one run each; then three runs each, as medians, for the 7 cover-photo pages on the phone.

| configuration | pages | Performance | LCP | CLS | TBT | Accessibility and Best Practices | SEO, crawlability aside |
|---|---|---|---|---|---|---|---|
| Desktop, both themes | 18 | 100 | 0.27 to 0.72 s | 0 | 0 ms | 100 | 100 |
| Phone, both themes, largest paint is text | 11 | 99 to 100 | 0.91 to 1.15 s | 0 | 12 to 98 ms | 100 | 100 |
| Phone, both themes, largest paint is the cover photo | 7 | 95 to 99 | 1.98 to 2.88 s | 0 | 17 to 57 ms | 100 | 100 |

- **Result:** 59 of the 72 page and configuration pairs pass every budget. The other 13 are cover-photo pages on the phone, failing LCP only, by 0.13 to 0.88 s. Blueprint: raven 2.73 s, stmicroelectronics 2.28, crossfit-megatrons 2.28, engr172-build-a-bronco 2.73, palmsync 2.58, smart-plant-care 2.27 (fsae-bronco-racing passes at 1.98). Whiteprint: raven 2.29, fsae-bronco-racing 2.88, stmicroelectronics 2.13, crossfit-megatrons 2.13, engr172-build-a-bronco 2.13, palmsync 2.28, smart-plant-care 2.28. Single runs of one page ranged from 1.68 to 3.52 s.
- **Why:** on each of these pages the first paint is at 1.08 s and the photo paints in the first frame. Lighthouse's model charges a picture's paint with every script that begins before it, and Next 14 begins its scripts there; round D's analysis is in `docs/V3_PLAN.md` 11.7. Lab runs on the local server (HTTP/1.1, which slows the model further) gave 4.1 to 4.4 s for these pages before the preview existed. How to treat these pages is the owner's decision (`docs/V3_FOLLOWUPS.md` 26).
- **The other budgets:** the Vercel build of the same commit reports a home first load of 156,781 of 160,000 bytes brotli, with no three.js or viewer code in any first load, and the sky's deferred chunk at 149,218 of 220,000; `check:sky` holds the star data and the textures to their budgets. Interaction to Next Paint cannot be measured in the lab (D-80); Total Blocking Time, its stand-in, is at most 98 ms. SEO is 100 with the crawlability audit left out, which fails on every preview by design because Vercel marks previews `noindex`.
- **Locally,** `npm run lighthouse` (three runs per page, round D's build) passed every assertion on the desktop in both themes (108 of 108 each) and 112 of 126 on the phone in each theme, failing only on the same 7 pages.

### 13. axe on the preview

**Pass.** axe-core 4.11.4 with every WCAG 2.0, 2.1 and 2.2 A and AA rule, after each page had been scrolled through so every panel had risen: 76 page loads (the 18 public pages and a missing page, both themes, 390 and 1440 px), 0 violations, each in the theme it was asked for. The only console messages were the browser noting the missing page's own 404 status.

### 14. `main`, and the pull request

`main` is untouched at `0b35c7a`, the commit `v3` was cut from. The pull request from `v3` to `main` is opened after this report; merging it is the owner's.

## Not covered by this run

- Safari, Firefox and a real phone (`docs/V3_FOLLOWUPS.md` 16).
- The hero's model and media modes with the owner's own files, which are not uploaded yet.
- The admin's cycle on this preview, which needs the owner's sign-in.
- A green CI run: CI stops at its first step until the owner adds the `MOTION_TOKEN` and `CONTENT_BLOCKLIST` secrets; its secret scan and commit-message check pass.
- SEO on a preview: Vercel marks previews `noindex`, so Lighthouse's crawlability audit fails there by design and SEO is judged without it (D-80); production can be checked after the merge.
- Interaction to Next Paint cannot be measured in the lab; Total Blocking Time stands in for it (D-80).
