# Standing rules for this repository

This repository builds amjadrehawi.com for its owner, Amjad Rehawi. Version 3 is being built on the `v3` branch from a handoff folder that the owner adds to each session. These rules bind every session and every file. If a request seems to collide with a rule, stop and ask the owner.

## Where the truth is

- The v3 specification is the handoff folder: `ARCHITECTURE.md`, `DESIGN_DIRECTION.md`, `CONTENT_RULES.md`, `content-rules.public.json`, and `seed/`. Read all of it before writing code. It is read-only.
- Section 2 of `docs/V3_PLAN.md` pins every handoff file by hash. Before each phase, compare the handoff with those pins. If any file differs, read the changed files again and update the plan before writing code. Compare hashes, not revision lines: the seed files have none.
- On the owner's computer, outside this repository, read only the handoff folder and the Claude Design handoff bundle. Web documentation and the session's tools are fine.
- Do not copy handoff files into this repository. The only exceptions are `content-rules.public.json` and the seed with every key that starts with an underscore removed. `docs/` holds short, public-safe summaries written for this repository.
- Precedence: where `ARCHITECTURE.md` and the Claude Design handoff bundle disagree, the bundle wins on visual detail, and `ARCHITECTURE.md` wins on behavior, data, security, and content rules. `DESIGN_DIRECTION.md` is the fallback for visuals wherever the bundle is silent. This file and everything in `docs/` summarize the handoff and never override it; where they differ, the handoff wins and the summary is corrected.
- When nothing covers a choice: accurate over impressive, fast over heavy, editable over hard-coded, quiet over animated.
- The build plan is `docs/V3_PLAN.md`. Its resolutions are proposals until the owner answers the matching question in its section 8; until then, the handoff holds.
- Confirm each library version against that package's own documentation on the day you use it. Prefer the session's documentation, Motion, Vercel, GitHub, and Playwright tools over guessing; section 9 of `docs/V3_PLAN.md` says which tool serves which job. Use npm, with one lockfile.

## Branches and releases

- Until `v3` merges, work only on `v3`. Never push to `main`, merge into it, or rewrite it.
- Make any other branch (the Phase 6 sandbox branches, a patch branch for the live site) only after the owner says yes to that branch.
- Production changes only when the owner merges the pull request. Open that pull request only in the release phase, when the owner asks.
- Every push to `v3` gets a Vercel preview deployment. That preview is what the owner reviews.
- Build in the phases of `ARCHITECTURE.md` section 14. Each phase ends with a commit on `v3`, a green CI run, the preview URL, and a short report. Then stop and wait for the owner's go.

## Secrets

- Never commit a secret and never print one: not in files, logs, test output, test artifacts, commit messages, or chat.
- Never open or print `.mcp.json`, or any `.env` file other than `.env.example`.
- Secrets live only in Vercel environment variables, GitHub Actions secrets, and the owner's own environment (`.env.local`, which git ignores, and user environment variables). `.env.example` lists the names with empty values.
- The environment variables: `ADMIN_PASSWORD`, `SESSION_SECRET`, `GITHUB_TOKEN`, `GITHUB_REPO`, `GITHUB_BRANCH`, `GITHUB_DRAFT_BRANCH`, `MOTION_TOKEN`, `CONTENT_BLOCKLIST`, `BLOB_READ_WRITE_TOKEN` (unless Blob uses OIDC), the optional `VERCEL_TOKEN` and `VERCEL_PROJECT_ID`, and, in GitHub Actions only, `VERCEL_AUTOMATION_BYPASS_SECRET` for testing previews.
- `CONTENT_BLOCKLIST` holds terms that must never appear on the site or in this repository. Never ask for its value, print it, or write its terms anywhere, including CI logs.
- `MOTION_TOKEN` reaches the install step only through the environment. It never appears in a committed file, the lockfile included. Once Motion+ is a dependency, npm commands fail unless `MOTION_TOKEN` is set in the environment.
- A key for any MCP server or tool is configured outside the repository and is never committed.
- A secret that reaches git is rotated by its owner. Rewriting history does not fix it.
- Never skip hooks or checks (no `--no-verify`).

## Writing

- No em dashes or en dashes anywhere: copy, code, comments, commit messages, pull request text, documentation. Use a comma, a colon, parentheses, "to" for ranges, or a new sentence.
- Treat everything committed or pushed here as public. The content rules below bind the site, the README, `docs/`, and code comments, and `docs/` is checked by the same patterns as the site. Commit messages, pull request text, and branch names are public too: no secrets, no blocklisted or private terms, and no claim the content rules forbid.
- Refer to a content rule by its id or in neutral words, never by quoting its message, its pattern, or a banned phrase. One rule's id matches its own pattern; name that rule in words.

## Site content

- The seed is the only source of site content. Never take copy from the live site, from the v2 `content/` folder, or from memory. The v2 `content/` folder is read only to learn which media files exist.
- Documented facts only. Never estimate, round up, or fill a gap. If a fact is not in the seed, it is not on the site.
- Use the seed's exact status words: designed, built, programmed, bench-validated, shipped, delivered, in progress, planned. A plan is written as a plan.
- Approximate values keep their hedge everywhere, readouts and callouts included.
- Team work is credited to the team wherever the seed says so.
- Real media only. Photos, video, documents, and 3D models are the owner's own files. Never a stock or generated picture of hardware, people, or results. Never use an image, video, or 3D generation tool for them. Generated media is allowed only for abstract atmosphere that the design calls for and real data cannot supply, and only after the owner says yes to that item.
- The star names and positions in the sky background come from a real catalog, and the footer credits the data sources.
- The only GPA on the site is the major GPA, always printed as its label and value together: "Major GPA 3.65". No component prints the value without the label, and the word cumulative never sits beside it.
- An empty string in `phone`, `gpa`, or a cover `src` means "do not show". Never render a dash or an empty label in its place.
- A project with `visible: false` appears nowhere public: not in lists, static params, the sitemap, JSON-LD, Open Graph images, or page source.
- No resume file is ever served. The "Request my resume" button opens an email to the owner.
- Never link this site's own repository. GitHub links go to the owner's profile and to project repositories he has made public, which he adds one by one in the admin.
- The startup is "a stealth AI hardware startup", and the owner's title there is Founder & Lead Engineer. Never name it or give its web address.
- Never name any customer, vendor, investor, sponsor in talks, or accelerator. How this applies to names the seed already uses is an open question (Q-13 in `docs/V3_PLAN.md`); until the owner answers, keep the seed's wording and add no new such name.
- Say nothing about how a piece of work was produced beyond what the seed says.
- Allowed links: the owner's email and phone, LinkedIn (shown as the word "LinkedIn"), his GitHub profile, his scheduling link ("Book a call"), the site itself, and project proof (a project page, a public repository, a video, a paper, a results page). Never a cloud-drive link.
- Never invent alt text. Seed images have empty alt; list those files for the owner to describe in the admin. A missing photo stays a placeholder until the owner uploads one.
- The hiring line is exactly: `Available: Full-time, June 2027`.

## Wording by subject

- Raven is the project. It is a custom redesign built on the Flightory Stallion FPV airframe, its stock base. It is never called by the base airframe's name and never described as designed from nothing.
- Raven's Stage 1 of the 8-stage roadmap is in progress, and stages 2 to 8 are plans. The site makes no flight or hover statement about Raven, and no statement that autonomy software, flight software, or onboard perception exists.
- Raven's roadmap ends in "coordinated multi-drone autonomy", worded exactly so. FAA Part 107 is "in progress".
- The hero's thermal view is labelled as an illustration and carries no temperature or telemetry numbers.
- The hero drawing of Raven is an original, simple tri-tiltrotor outline. Never trace the stock airframe or any commercial aircraft. Its caption reads exactly: "Raven, tri-tiltrotor eVTOL. Illustration, not measured data."
- The hero never shows invented 3D geometry; the only 3D hero is the owner's own model.
- Raven is a personal project. The senior design project is a separate team project, and the two are never mixed.
- Bronco Racing titles, by period, each kept with its own dates:
  - Electrical Specialist, Sep 2023 to Nov 2025.
  - High-Voltage & Co-Electrical Lead on BR1, Nov 2025 to Jun 2026.
  - Electrical System Officer (ESO) & HV Engineer on BR2, Jul 2026 to present.
- The lead title is never shown with a start in 2023.
- BR1 is 100s3p, about 360 V nominal and about 420 V max. BR2 is 120s4p, about 432 V nominal and 504 V max. The 540 V figure is the on-board charger's rating and is never attached to a pack.
- The BMS is an off-the-shelf Orion BMS 2 that he programmed, configured, and modified. The thermistor count is "140+".
- FSAE 2026: the team completed the static events. The high-voltage system was designed, built, programmed, and bench-validated, and was not energized at competition, a deliberate safety call. The site says nothing more about that competition.
- BR2 public copy uses team wording: "work with the team across the electrical and tractive-system stack".
- STMicroelectronics: Application Engineer Intern, Jun 2025 to Dec 2025. One customer's inverter, never named, always singular. The phrase is "engineering experience", never a stronger one.
- Senior design (SCU Pegasus, Design-Build-Vertical Flight) is a team project, credited to the team. His part is the electrical system: the electronics, software, and automation.
- His six electrical areas are named exactly: payload electronics; navigation and GPS; autonomy and physical AI; electrical safety switches and mechanisms; communication and RF; power distribution. They are areas of work on an aircraft in design, not finished results, and the RF area is not a claim of RF design experience anywhere else on the site.
- The senior design team is five students: four mechanical engineers and him, a double major in mechanical and electrical engineering. Teammates' names and faculty names stay off the page.
- The senior design aircraft is in design. The site says nothing about it being built, powered, or flown until the owner adds that.
- MoonLamp: he designed and 3D-printed the shell and hand-designed and hand-soldered the electronics. Its firmware is described only as "the firmware, which I reworked, integrated, and debugged" and "firmware running on the lamp", with no test or check counts.
- PalmSync took 1st Place at the Asearis Hackathon. The CrossFit Maker Challenge team took 2nd Place and $1,500. Never swap them.
- PalmSync has no accuracy figure, and its $14.82 and $49.99 figures are targets.
- No intellectual-property claim of any kind.
- "Honors" means membership in the University Honors Program. No graduation honor is stated before graduation. The honors thesis is "in progress", with no topic stated.
- The A-Levels are University of Cambridge qualifications, not attendance at the university.
- The PCB tool is KiCad 9 and the simulation tool is LTspice. Name no other PCB or circuit-simulation tool.

## Content checks

- `content-rules.public.json` holds the publishable patterns, each with an id and a message. The server-only `CONTENT_BLOCKLIST` adds private terms: entries separated by a vertical bar, matched as whole words without regard to case, and with exact case when an entry starts with `cs:`.
- The check runs over string values (never keys or raw JSON text) on every admin save, in `npm run check:content` (also the pre-commit hook), in CI, and before every Vercel build (`prebuild`, once Q-33 is settled). A failing check rejects the save or stops the deploy.
- Besides `content/`, the check scans `docs/`, every string literal and piece of JSX text in `app/`, `components/`, and `lib/`, and every source file for em and en dashes. The v2 admin and API join the string scan in Phase 6, and `README.md` joins when Phase 1 rewrites it. It never scans `content-rules.public.json` itself, whose messages match their own patterns.
- A public-rule hit reports the rule id, the field path, and the rule's message. A blocklist hit reports its field and rule, never the matched term.
- Never weaken a rule to make a save or a build pass. A rule changes only when the owner sends a new handoff.

## Code conventions

- Words a visitor sees come from `content/` or, for interface labels that state no fact, from `lib/strings.ts`. Never put a label in a component.
- Client components never receive whole content records: pass small objects built on the server, so a hidden project or an empty field cannot leak through props.
- Content links go through `lib/links.ts`: a link to a hidden or unknown page prints as plain text. Media goes through `resolveMedia` in `lib/media-server.ts`, which returns nothing for an empty `src`.
- Every viewer sits in `components/viewers/`, paints its poster first, and loads its engine through `useViewerActivation` and a dynamic import. After adding one, check that no three.js, pdf.js, docx-preview, or shiki code is in any first load (the route table that `next build` prints, and `.next/app-build-manifest.json`).
- Every token value lives in `app/tokens.css`, the only file with hex values. Components use the design bundle's `ar-*` classes in `app/sheet.css` and the building blocks in `components/sheet/`; page styles live in `app/styles/`. `app/legacy.css` serves only the v2 admin until Phase 6.
- Page layout uses container queries on the page frame (`@container frame (min-width: 1024px)` and so on), never viewport media queries: with a classic scrollbar the frame is narrower than the window, and the chrome follows the frame.
- The thermal ramp (`--t0` to `--t6` and the `--heat` gradients) appears only in the eight places of `DESIGN_DIRECTION.md` 2.4, and a page has one filled amber element, its primary `Button`.
- Run `npm test` before every commit, and `npm run test:build` after changes to pages, metadata, JSON-LD, or the sitemap.
- `/dev/blocks` and `public/dev/samples/` are for testing the viewers and are removed before release.
- `next dev` or `next build` with `NEXT_DIST_DIR` adds an entry to `tsconfig.json`; restore that file before committing.

## Scope

- Do not add a database, a headless CMS service, a UI kit, a CSS-in-JS runtime, jQuery, a carousel library other than Motion+, or any tracker.
- Ask the owner before building anything on this list: a blog, comments, a contact form, user accounts, internationalization, e-commerce, a resume file download, a chatbot, third-party tracking, or any generated or stock picture of hardware.
- Search Motion's documentation (the Motion AI Kit) before writing any animation.
