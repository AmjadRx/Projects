# Admin guide

A short public summary of the admin at `/admin`, which edits every word and file on the site. It
never changes the live site directly: each save is one commit on a draft branch, Vercel builds a
preview of that branch, and Publish moves the live branch forward to the draft once the preview
looks right.

## Setting it up

Every value lives in Vercel's environment variables (and, for local work, in `.env.local`, which
git ignores). `.env.example` lists every name; values are never committed.

| variable | what it is |
|---|---|
| `ADMIN_PASSWORD`, `SESSION_SECRET` | The admin password, and a long random secret that signs sessions. Without both, `/admin` shows a setup notice and every admin route answers 503. There is no fallback. |
| `GITHUB_TOKEN`, `GITHUB_REPO` | A fine-grained token for this one repository (Contents read and write, Deployments read), and the repository's `owner/name`. |
| `GITHUB_BRANCH`, `GITHUB_DRAFT_BRANCH` | The published branch and the branch saves go to (`main` and `draft` in Production). The draft branch can never be `main`. |
| `CONTENT_BLOCKLIST` | The private terms the content check refuses. Builds on Vercel fail without it. |
| `BLOB_READ_WRITE_TOKEN`, `BLOB_STORE_HOST` | Set by connecting a public Vercel Blob store; needed for files over 4 MB. The host is optional and worked out from the token when unset. |
| `MOTION_TOKEN` | Installs the Motion+ package for builds. |
| `VERCEL_TOKEN`, `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID`, `DRAFT_PREVIEW_URL` | Optional: deploy state from Vercel, and the draft's preview address when it cannot be worked out. |
| `NEXT_PUBLIC_SITE_URL` | Optional: the production address used in metadata and the content check. |

Until v3 is released, Preview deployments use sandbox branches, so no preview can change the live
site, and the code refuses to publish into `main` anywhere but Production. Give Preview its own
Blob store so a test delete never touches a file the live site uses.

The Settings tab's status panel shows each variable by name as set or missing, the GitHub
connection, both branches, storage, the content check, and the latest deployments. It never shows
a value.

## Signing in

A session lasts eight hours; when it ends mid-edit, the admin asks for the password again and keeps
the unsaved work. Repeated wrong passwords lock sign-in for a while; waiting ends the lock. A
Vercel Firewall rate limit on sign-in attempts sits in front of the admin, managed in the Vercel
dashboard. Changing `ADMIN_PASSWORD` or `SESSION_SECRET` signs every session out.

## Editing and saving

- The tabs edit the site's settings and pages; the Projects tab edits one file per project.
- The save bar counts the files with unsaved changes. Save (or Ctrl+S) commits only those files,
  as one commit. Undo and Redo cover the whole editing session.
- A save that would overwrite a change made elsewhere since the editor loaded (another window, a
  discard, a merge) stops with a conflict instead; reload to see the change.
- If GitHub refuses a save, the message names the refused call and, where GitHub says so, the
  permission the token lacks.

## The content check

Every save runs the same check as `npm run check:content` over the whole site as it will be after
the save: the schema, the public rules in `content-rules.public.json`, and the private terms. A
refusal names the rule id and the field, and the admin takes you to the field; a private-term hit
never shows the term. A proof that points at a hidden or deleted project is refused too. The draft
is checked again before every Vercel build, so a failing draft can never be published.
`docs/CONTENT_RULES.md` summarizes the rules.

The warning list never blocks a save. It flags missing alt text or descriptions, a project without
a cover, internal links to pages that do not exist, empty highlights, a file name that looks like a
resume, and links of a kind the site does not use.

## Preview, publish, and discard

- After a save, the save bar shows the draft's preview address and its build state.
- **Publish** lists every changed file and the draft's build state, then fast-forwards the
  published branch to the draft. It is refused while the preview build is running or has failed,
  and when the draft changed after the dialog opened.
- If the published branch moved on meanwhile, **Bring the draft up to date** merges it into the
  draft and starts a new preview; check it, then publish.
- **Discard** resets the draft to the published branch. Uploaded Blob files stay in the store and
  are listed under "Not used anywhere" in the media library.

## Media

Each project has a media library, and the site has one more (Settings, Media). Drop many files at
once; each gets its own progress bar. Files are prepared in the browser before they are stored:

| kind | stored as |
|---|---|
| Photos (JPEG, PNG, WebP, AVIF, GIF, HEIC) | WebP, at most 2560 px, without metadata |
| Drawings (SVG) | SVG, cleaned on the server |
| Video (MP4, WebM, MOV) | as uploaded (MOV re-wrapped to MP4), with a poster frame |
| Documents (PDF, DOCX) | as uploaded, with a poster; the text goes through the content check |
| Office files (XLSX, PPTX, ODT, ODS, ODP) | as uploaded, offered as a download |
| 3D models (GLB, glTF, STL, OBJ, 3MF, PLY, STEP) | one compressed GLB with a poster; part names go through the content check |
| Audio (MP3, M4A, WAV) | MP3 or AAC, with its waveform |
| Captions (WebVTT) | as uploaded |
| Anything else | as uploaded, offered as a download |

Files up to 4 MB go into the repository with the next save; larger ones go from the browser to
Vercel Blob (up to 500 MB). STEP files convert in the browser; one over 50 MB, or that takes over
two minutes, asks for a GLB or STL export instead. Some files ask before they are stored, for
example a video whose sound would be dropped or a file whose name looks like a resume (no resume
file is ever served here). Rename and Replace keep every reference working, and a file still in use
cannot be deleted.
