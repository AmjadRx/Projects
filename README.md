# Amjad Rehawi — Portfolio

Personal portfolio for **Amjad Rehawi**, senior honors EE + ME at Santa Clara University.
Brand: *Hardware engineer for things that move themselves.*

Live: https://amjadrehawi.com — alias of https://amjad-rehawi.netlify.app

---

## Stack

- **Next.js 14** (App Router) · TypeScript · React 18
- **Tailwind CSS** with CSS-variable brand tokens (no hard-coded hex codes in components)
- **Three.js + @react-three/fiber + @react-three/drei** — hero drone scene
- **Netlify Blobs** — canonical content store, with `data/seed-content.json` as the fallback
- **Netlify Functions / Next.js API routes** — GET `/api/content`, POST `/api/save`
- Hosted on **Netlify** with `@netlify/plugin-nextjs`

## Local dev

```bash
npm install
npm run dev
```

Visit `http://localhost:3000`. The dev server reads from Netlify Blobs in production; locally it falls back to the seed JSON when Blobs is unreachable.

To exercise the admin save flow locally, set:

```bash
export ADMIN_PASSWORD="your-secret"
```

## Deploy

Netlify auto-deploys on push. The only required env var is `ADMIN_PASSWORD`.

## Editing content

Open `/admin`, enter the shared password, edit any tab, click **Save**. Changes go to Netlify Blobs and are picked up by the next public page load — no redeploy needed.

## Directory layout

```
app/
  page.tsx              Home
  projects/             /projects + /projects/[slug]
  admin/                Admin dashboard
  api/content/route.ts  GET content (Blobs → seed fallback)
  api/save/route.ts     POST content (password-gated)
components/
  sections/             Home section components
  admin/                Dashboard UI
  DroneScene.tsx        R3F hero drone
data/seed-content.json  Source-of-truth content fallback
lib/types.ts            Content schema
lib/content.ts          Blobs read/write helpers
```

## Brand tokens

| Token | Value |
|---|---|
| `cyan` | `#3DE0FF` |
| `navy` | `#0b0f17` |
| `navy-2` / `navy-3` | `#0f1521` / `#161d2c` |
| `purple` | `#7C5CFF` |
| `ink` / `ink-dim` / `ink-mute` | `#e9eef8` / `#aab3c5` / `#6b7385` |
| display | Space Grotesk |
| mono | JetBrains Mono |
