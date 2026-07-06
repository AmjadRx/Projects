# amjadrehawi.com

Personal portfolio for **Amjad Rehawi**: hardware engineer for things that move themselves.
Built to Build Brief v2. Deploys on **Vercel** (primary) or Netlify — no host-specific APIs.

## Deploy on Vercel

1. Go to [vercel.com/new](https://vercel.com/new) and import the `AmjadRx/Projects` repo.
   Framework preset: **Next.js** (auto-detected). Build command and output: defaults.
2. Set the environment variables below (Project → Settings → Environment Variables).
3. Add the custom domain `amjadrehawi.com` under Project → Settings → Domains and point
   the domain's DNS at Vercel (A record `76.76.21.21` or CNAME `cname.vercel-dns.com`).
4. Every push to `main` deploys production. Admin saves commit to `main`, which
   triggers the next deploy automatically.

Security headers ship from `next.config.mjs` (`headers()`), so they apply on any host.

## Stack

- **Next.js 14** App Router · TypeScript strict · React 18
- **Tailwind CSS** with CSS-variable theme tokens; **dual theme** (dark default + light) with cookie persistence and zero-flash inline script
- **Framer Motion** for scroll reveals, page transitions, mobile menu, gallery lightbox
- **three + @react-three/fiber** lazy-loaded 3D hero (desktop only, reduced-motion aware)
- **Git-based CMS**: the admin dashboard commits JSON + media to this repo through the GitHub Contents API, which triggers a redeploy. No database.
- **zod** validation on every save; **lucide-react** + inline brand SVGs for icons

## Content model

```
content/
  site.json            settings, personal, socials, nav, stats, thesis, about,
                       skills, experience, honors, education, contact
  projects/*.json      one file per project (slug = filename), block-based body
public/media/{scope}/  uploaded media per project slug + "site"
```

Project bodies are composable **blocks**: heading, text (markdown), image, gallery
(scroll-snap carousel + lightbox), video (file or YouTube/Vimeo embed), specTable,
bullets, twoCol, quote, linkRow, roadmap, log (dated build-log entries). Unknown
block types render nothing (forward compatible).

## Environment variables

| Var | Required | Purpose |
|---|---|---|
| `ADMIN_PASSWORD` | recommended | Admin login (server-side check; httpOnly session cookie) |
| `GITHUB_TOKEN` | prod | Fine-grained PAT, this repo only, Contents read/write |
| `GITHUB_REPO` | prod | `AmjadRx/Projects` — GitHub-CMS mode is ON only when both this and the token are set |
| `GITHUB_BRANCH` | optional | defaults to `main` |

To create the token: GitHub → Settings → Developer settings → Fine-grained personal
access tokens → Generate new token → Repository access: only `AmjadRx/Projects` →
Permissions → Contents: **Read and write**. Paste it into Vercel as `GITHUB_TOKEN`.

Without `GITHUB_TOKEN` + `GITHUB_REPO` (local dev), `/api/save` and `/api/upload`
write straight to the local filesystem, so the admin works offline.

## Local dev

```bash
npm install
npm run dev        # http://localhost:3000, admin at /admin
npm run build      # production build (all pages static)
npm run lint       # eslint
npm run type-check # tsc --noEmit
```

## How saving works

1. `/admin` edits a draft of the content JSON in memory.
2. Save → `POST /api/save` validates the session cookie + zod schemas, then commits
   each changed file via the GitHub Contents API (or writes locally in dev).
3. The push triggers the Netlify/Vercel rebuild; the banner says
   "Saved and committed. Site rebuilds in ~1–2 min."
4. Media uploads (`POST /api/upload`) are size-checked (images ≤ 8 MB after
   client-side WebP compression, video ≤ 25 MB) and committed to
   `public/media/{scope}/`.

## Hard content rules

- Documented metrics only; never invent numbers.
- No patents, anywhere.
- Raven = flagship project. Stallion = the stock Flightory airframe it is built on.
- The startup is "a stealth AI hardware startup", never named.
- FAA Part 107: "in progress".
- Availability: Summer 2027 internships / full-time 2027.
