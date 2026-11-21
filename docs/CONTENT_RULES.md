# Content rules

A short public summary of the rules every word on this site follows: the content files, anything
typed into the admin, alt text, captions, metadata, the generated share images, and this
repository's own documents. The owner keeps the full rules. The part a machine can check is
public, in `content-rules.public.json`; private terms the site must never show live only in the
`CONTENT_BLOCKLIST` environment variable and never appear in this repository.

## The standard

- **Documented facts only.** Every number, title, date, result, and status comes from the content
  files. Nothing is estimated, rounded up, or filled in.
- **Exact status words.** Designed, built, programmed, bench-validated, shipped, delivered, in
  progress, and planned each mean something different, and a plan is written as a plan.
- **Approximate stays approximate.** A value given as "about" or as an estimate keeps that
  wording everywhere it appears, readouts and callouts included.
- **Team work is credited to the team.**
- **Real media only.** Photos, video, documents, and 3D models are the owner's own. No stock or
  generated pictures of hardware, people, or results. The star catalog and the Milky Way image
  behind the pages are credited in the footer and in `public/sky/CREDITS.md`.
- **No em dashes or en dashes**, anywhere. Ranges use "to".

## Wording that is fixed

- The GPA is always written "Major GPA 3.65", label and value together, wherever it appears,
  metadata and share images included.
- Some subjects have exact wording in the owner's rules: project and role names, titles and their
  dates, roadmap stages, competition results, figures that are targets or estimates, and the
  hiring line. Where a machine can check such wording, a rule in `content-rules.public.json` does.

## What the site never shows

- A resume file. The "Request my resume" button opens an email instead.
- This site's own repository. GitHub links go to the owner's profile and to the project
  repositories the owner has made public.
- Company names the owner keeps private.
- A project the owner has hidden, or a field left empty: neither leaves a trace in the pages, the
  links, the metadata, the structured data, the sitemap, the search index of the command palette,
  or the share images.

## Links

Allowed: the owner's email and phone, LinkedIn, the owner's GitHub profile and scheduling link,
this site, and proof of a project (a project page, a public repository, a video, a paper, or a
results page). Never a cloud-drive link.

## How the rules are enforced

`npm run check:content` runs the schema, the public rules, and the private terms over all content.
It runs before every commit, in CI, before every Vercel build, and on every save in the admin. A
save or build that breaks a rule is refused with the rule's id and the field. After each build,
`check:secrets --build` also scans the output for the private terms. Rules change only when the
owner changes them.
