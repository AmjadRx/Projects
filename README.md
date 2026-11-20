# amjadrehawi.com

The portfolio of Amjad Rehawi, drawn as an engineering drawing sheet over a real night sky, with an
admin that edits every word and file through git. Version 3 is built on the `v3` branch; `main`
holds the published site.

## Documents

| document | what it covers |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | How the site is built: stack, layout, pages, motion, budgets, accessibility, security, checks. |
| [`docs/ADMIN_GUIDE.md`](docs/ADMIN_GUIDE.md) | Setting up and using `/admin`: variables, saving, the content check, preview, publish, media. |
| [`docs/CONTENT_RULES.md`](docs/CONTENT_RULES.md) | The rules every word on the site follows, and how they are enforced. |
| [`docs/V3_PLAN.md`](docs/V3_PLAN.md) | The rebuild plan, its decisions, and what each phase built. |
| [`docs/V3_ACCEPTANCE.md`](docs/V3_ACCEPTANCE.md) | The acceptance list, item by item, with its evidence. |
| [`docs/V3_FOLLOWUPS.md`](docs/V3_FOLLOWUPS.md) | Open items and questions for the owner. |

## Setting up

1. Node.js 24 (what Vercel builds on).
2. Motion+ installs from a private registry: `.npmrc` reads the `MOTION_TOKEN` environment
   variable. Set it in your shell before any npm command; it is never written to a file in this
   repository.
3. `npm ci` installs the exact lockfile.
4. Copy `.env.example` to `.env.local` (git ignores it) and fill in what you need. Without the
   GitHub variables the admin saves to your own disk. `docs/ADMIN_GUIDE.md` explains each variable.
5. `npm run dev` serves the site at http://localhost:3000 and the admin at `/admin`.

## Scripts

| script | what it does |
|---|---|
| `npm run dev`, `npm run build`, `npm start` | Develop, build (every public page is static), and serve a build. `build` first checks the lockfile, the content, and the sky data, and afterwards the weight of the first load and the build output for secrets. |
| `npm run lint`, `npm run lint:tests`, `npm run type-check` | ESLint over the app and over the tests, and TypeScript. |
| `npm test` | The unit tests (Vitest). |
| `npm run test:build` | The build tests: a production build checked for fidelity and for hidden content. |
| `npm run test:e2e` | The end-to-end and accessibility suite (Playwright and axe, Google Chrome), on a production build it makes itself. |
| `npm run lighthouse` | Lighthouse CI against the budgets in `docs/ARCHITECTURE.md`, on every public page, phone and desktop, both themes. Run `npm run build` first. |
| `npm run check:content` | The content check: the schema, the public rules, and the private terms. Also a pre-commit hook. |
| `npm run check:lockfile`, `npm run check:secrets` | The lockfile and token check (also a pre-commit hook), and the scan of tracked files or, with `--build`, of the build output. |
| `npm run check:sky`, `npm run build:sky`, `npm run render:stills` | The sky's data and budgets, the star data build, and the still images. |
| `npm run screenshots` | Screenshots of every page at four widths in both themes. |

## Continuous integration

`.github/workflows/ci.yml` runs on pushes to `v3` and on pull requests to `main`. It never deploys.
Its jobs: lint, types, unit tests and the content check; the production build with its weight and
secret checks, then the build tests; Lighthouse CI for phone and desktop in both themes; the
end-to-end suite; and a secret scan with gitleaks. It needs two repository secrets, which the
owner adds under Settings, Secrets and variables, Actions: `MOTION_TOKEN` and `CONTENT_BLOCKLIST`.

## Deploying

Vercel builds every push. Production follows `main`; every other branch gets a preview. The
environment variables live in the Vercel project (`docs/ADMIN_GUIDE.md`). A build whose content
check fails does not deploy.

## Licences

The fonts are under the SIL Open Font License (`licenses/`). The star catalog and the Milky Way
image are credited in `public/sky/CREDITS.md`. Notices for code the admin loads are in
`licenses/ADMIN-NOTICES.md`.
