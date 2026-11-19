# Admin guide

The admin at `/admin` edits every word and file on the site. It never writes to the live site
directly: each save becomes one commit on a draft branch, Vercel builds a preview of that branch,
and Publish moves the live branch forward to the draft once you have looked at the preview.

## 1. Setting it up

Every value lives in Vercel (Settings, Environment Variables) and, for local work, in
`.env.local`, which git ignores. `.env.example` lists the names. Nothing here is ever committed.

| variable | required | what it is |
|---|---|---|
| `ADMIN_PASSWORD` | yes | The admin password. Use a long one from a password manager. |
| `SESSION_SECRET` | yes | At least 32 random characters that sign the session cookie. Generate it in your own terminal or password manager; never paste it into a chat. |
| `GITHUB_TOKEN` | yes | A fine-grained token for this one repository: Contents read and write, plus Deployments read for the deploy state. |
| `GITHUB_REPO` | yes | `owner/name` of this repository. |
| `GITHUB_BRANCH` | yes | The published branch: `main` in Production. |
| `GITHUB_DRAFT_BRANCH` | yes | The branch saves go to: `draft` in Production. It can never be `main`. |
| `CONTENT_BLOCKLIST` | yes | The private terms the content check refuses (section 4). |
| `BLOB_READ_WRITE_TOKEN` | for files over 4 MB | Set by connecting a Vercel Blob store to the environment. |
| `VERCEL_TOKEN`, `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID` | no | Deploy state from Vercel itself. Without them, deploy state comes from GitHub's deployment records. |
| `DRAFT_PREVIEW_URL` | no | The draft branch's preview address, when the admin cannot work it out. |

Without `ADMIN_PASSWORD` or `SESSION_SECRET`, `/admin` shows a setup notice and every admin route
answers 503. There is no fallback password and no default branch.

**Previews use sandbox branches.** Until v3 is released, the Preview environment uses
`GITHUB_BRANCH = sandbox-main` and `GITHUB_DRAFT_BRANCH = sandbox-draft`, set as the default
Preview values so every preview gets them. A save on a preview then commits to `sandbox-draft`,
and Publish on a preview fast-forwards `sandbox-main`. The code also refuses to publish into
`main` anywhere but the production deployment, so no preview can change the live site. Use a
separate Blob store for Preview, so a test delete can never remove a file the live site uses.

**The status panel** (Settings tab) shows every variable by name with "set" or "missing", the
GitHub connection, both branches, storage, the content check, and the latest deployment of each
branch. It never shows a value.

## 2. Signing in

- A session lasts eight hours. When it ends while you are editing, the admin asks for the password
  again and keeps your unsaved work.
- Five wrong passwords from one address within ten minutes lock that address for ten minutes;
  during the lockout even the right password waits. Signing in clears the count. Only sign-in
  attempts count: checking the session and signing out never do.
- The address is the one Vercel records for the request (`x-real-ip`, which Vercel sets and a
  browser cannot). The count lives in Vercel Runtime Cache, shared by every server instance in the
  region; the status panel shows which store is in use. Runtime Cache has no atomic update, so
  when a burst of guesses is spread over several server instances at once, a few more than five
  can be checked before the lock holds (eight with four instances, in the tests). The firewall
  rule below, once enforced, is the exact limit.
- Changing `ADMIN_PASSWORD` or `SESSION_SECRET` signs every session out.

**If you lock yourself out**, any one of these works:

1. Wait ten minutes from the fifth wrong password.
2. Sign in from another network (your phone's hotspot, for example): the count is per address.
3. Clear the count at once by purging the project's Runtime Cache:
   `npx vercel@65.16.0 cache purge --type data --yes` (run it in a folder linked to the project).
   This also empties the project's data cache, which the site refills on its own. A redeploy does
   not clear the count, and neither does changing `SESSION_SECRET`.

A second, platform-level limit sits in front of the login route as a Vercel Firewall rule. Its two
conditions (path `/api/auth` and method `POST`) match sign-in attempts only, so checking the
session (`GET`) and signing out (`DELETE`) never use it up. To add it, link the project once and
stage the rule in log mode first:

```bash
npx vercel@65.16.0 link
npx vercel@65.16.0 firewall rules add "Admin login limit" \
  --condition '{"type":"path","op":"eq","value":"/api/auth"}' \
  --condition '{"type":"method","op":"eq","value":"POST"}' \
  --action rate_limit \
  --rate-limit-window 600 \
  --rate-limit-requests 5 \
  --rate-limit-keys ip \
  --rate-limit-action log \
  --yes
npx vercel@65.16.0 firewall diff
npx vercel@65.16.0 firewall publish --yes
```

After a few days of log data in the Firewall dashboard, switch it to enforce:

```bash
npx vercel@65.16.0 firewall rules edit "Admin login limit" --rate-limit-action rate_limit --yes
npx vercel@65.16.0 firewall publish --yes
```

Firewall counters are kept per region, and the admin's own lockout still applies behind it. In log
mode the rule blocks nothing and only records what it would have limited (Firewall tab, filter by
the rule).

**If the enforced firewall rule limits you**, either wait: its window is 600 seconds, so sign-in
works again within ten minutes. Or turn the rule off and publish the change: in the dashboard
(Firewall, the rule, Disable, Review Changes, Publish), or with
`npx vercel@65.16.0 firewall rules disable "Admin login limit"` and then
`npx vercel@65.16.0 firewall publish --yes`. Signing in from another network also works.

**What it costs.** On the Pro plan, WAF rate limiting is billed per million allowed requests that
the rule evaluates (0.50 to 0.80 US dollars per million, by region), taken from the plan's monthly
usage credit first. Only sign-in attempts are evaluated, so the cost is a fraction of a cent a
month; requests the rule limits are not billed. The admin's own lockout adds a Runtime Cache read
and write per attempt, which is just as small.

## 3. Editing and saving

- Twelve tabs edit `content/site.json`; the Projects tab edits one file per project.
- The save bar shows how many files have unsaved changes. Save (or Ctrl+S) sends only those files,
  as one commit. A file you did not change is never rewritten.
- Undo and Redo (the buttons, or Ctrl+Z and Ctrl+Shift+Z) cover the whole editing session, and
  typing in one field is one step. Inside a text field, Ctrl+Z is the browser's own undo for that
  field; elsewhere it undoes the session. Ctrl+S saves from anywhere.
- "Revert this file to published" loads the published version of a file into the editor, where you
  can still undo it.
- Each save carries a fingerprint of every file as this editor loaded it. If a file the save writes
  changed on the draft since then (a save from another window or your phone, a discard, a rename
  that rewrote it, or the published branch merged in), the save stops with a conflict instead of
  overwriting; reload to see the change. When files you did not touch changed meanwhile, the save
  bar says so and offers Reload.
- A save the content check refuses changes nothing: no commit, and no preview build.

## 4. The content check

Every save runs the same check as `npm run check:content` over the whole site as it will be after
the save: the schema, the public rules in `content-rules.public.json`, and then the private terms
in `CONTENT_BLOCKLIST`. A hit refuses the save and names the rule id, the file, and the field; the
admin takes you to the field. A private-term hit names the field and the entry number, never the
term itself.

The check also refuses a proof that leads to no visible page: a stat or a skill that points at a
hidden or deleted project. The warning list flags it before you save, so after hiding a project,
change or remove the proofs that point at it in the same save.

The draft branch is checked again before each Vercel build, and a failing check stops the build, so
a draft that fails can never be published.

Four public rules also refuse some ordinary wording. Reword the sentence; only a new handoff
changes a rule.

- **TEST-METHODS** names test methods that are not part of the documented work by their acronyms.
  One acronym is also an everyday English word, so a sentence using that word is refused too.
- **DBVF-FLOWN** keeps the senior design aircraft described as in design. It also refuses a common
  contraction and an ordinary verb when they sit near the aircraft's name.
- **RF** and **RAVEN-SOFTWARE** apply on every page, so they also refuse some future senior design
  updates that use their terms. Write autonomy and flight software as later, planned stages.

## 5. Warnings

The warning list (in each project and in the Settings tab) never blocks a save. It flags a photo
without alt text, a model or document without its short description, a project without a cover, an
internal link to a page that does not exist, an empty
highlight, a file name that looks like a resume, and a LinkedIn link with another label. Click a
warning to go to its field. It also flags an availability line that differs from the documented one,
and a link that is not a site path, an https address, an email address, or a phone link.

## 6. Publish and discard

- **Preview.** After a save, the save bar shows the draft's preview address and its build state.
- **Publish** opens a confirmation that lists every changed file, Blob files added or no longer
  used, and the draft's build state. Confirming fast-forwards the published branch to the draft.
  Publish is refused while the draft's build is running or has failed, when the published branch
  has commits the draft lacks, and when the draft changed after you opened the dialog.
- **If the published branch moved on** after the draft was last saved (a publish from another
  window, or a commit to that branch), Publish cannot fast-forward. The dialog says so and offers
  **Bring the draft up to date**, which merges the published branch into the draft as one commit
  and starts a new preview build; check the preview, then publish. If both changed the same lines,
  the merge is refused: discard the draft, or resolve the conflict on GitHub.
- Publish also waits for the draft's preview: it is refused while that build has not started, is
  running, failed, or was canceled. If the deploy state cannot be read at all, the dialog says so
  and Publish is allowed; "Check again" asks once more.
- **Discard** shows the draft's current commits and files when it opens, and is refused if the
  draft changed meanwhile (open it again to see the new count). It resets the draft to the
  published branch. Files uploaded to Blob stay in the store; the media library lists them under
  "Not used anywhere" so you can delete them.

## 7. Media

Each project has a media library, and the site has one more: Settings, Media. The same place lists
"Other folders": the files of a renamed or deleted project, so they can still be renamed, replaced,
or deleted. A renamed project keeps using its folder, and its addresses keep working. Drop many
files at once; each gets its own progress bar. A file lands in the field it was uploaded for even
if you move that block or close the tab meanwhile; if the field is gone, the file waits in its
folder's library. Files are prepared in your browser before they are stored:

| kind | accepted | stored as |
|---|---|---|
| Photo | JPEG, PNG, WebP, AVIF, GIF, HEIC | WebP, at most 2560 px; the original and its metadata are not kept; an animated GIF keeps its first frame |
| Drawing | SVG | SVG, cleaned on the server; repository only |
| Video | MP4, WebM, MOV | MOV is re-wrapped to MP4; a poster frame is captured; H.265 asks first |
| Document | PDF, DOCX | as uploaded; a PDF's first page becomes the poster; the text goes through the content check |
| Office file | XLSX, PPTX, ODT, ODS, ODP | as uploaded, as a download; old .doc, .xls, and .ppt files are refused (save them as DOCX, XLSX, PPTX, or PDF) |
| 3D model | GLB, glTF, STL, OBJ, 3MF, PLY, STEP | one compressed GLB, with its triangle count, size, and a poster; part names go through the content check |
| Audio | MP3, M4A, WAV | WAV becomes AAC (.m4a); the waveform is computed once |
| Captions | WebVTT | as uploaded |
| Anything else | other files | as uploaded, as a download |

STEP files convert in the browser with a CAD kernel. A file over 50 MB, or one that takes more than
two minutes, is refused with a message asking for a GLB or STL export instead. Other 3D files over
150 MB and Word files over 50 MB are refused before they are read. Every name inside a model
(parts, materials, animations, scenes) goes through the content check, also for models stored in
Blob.

Some files ask before they are stored: a video in H.265, or whose sound would be dropped; a PDF
with pages whose text cannot be read; a Word file with parts that cannot be read (embedded files,
such as a chart's workbook); a file whose name looks like a resume (no resume file is ever served
on this site); and a file that keeps metadata that cannot be removed.

Files up to 4 MB go into the repository with your next commit. Larger files go straight from your
browser to Vercel Blob (up to 500 MB) when a Blob store is connected; without one, they are refused
with a message that says how to connect it.

Photos need alt text, and models and documents need a short description; both are warnings, not
blocks. Rename and Replace keep every reference working. A file still used by the draft cannot be
deleted until you remove it from those fields; a Blob file also waits until the published site no
longer uses it.
