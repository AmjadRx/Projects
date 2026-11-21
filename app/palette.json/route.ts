import { paletteIndex } from '@/lib/palette';

/** Built once with the site, from the seed: a static file on the deployment. */
export const dynamic = 'force-static';

/**
 * /palette.json: the command palette's index (lib/palette.ts), fetched by the palette the first
 * time a visitor wants it (components/palette/load.ts). Visible projects only, like every page.
 */
export function GET(): Response {
  return Response.json(paletteIndex());
}
