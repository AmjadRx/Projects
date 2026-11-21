import { faviconIco } from '@/lib/og/render';
import { siteData } from '@/lib/site';

/**
 * /favicon.ico. Next 14 serves an icon here only from a static app/favicon.ico file, never from
 * app/icon.tsx, so a browser or a crawler that asks for /favicon.ico (the pages link /icon, but
 * not every client reads the link) would get a 404, which a browser logs as a console error. This
 * route answers with the site icon at 16, 32, and 48 px in one icon file, drawn at build time.
 */
export const dynamic = 'force-static';

export async function GET(): Promise<Response> {
  const body = await faviconIco(siteData().site.personal.name);
  return new Response(body, {
    headers: { 'Content-Type': 'image/x-icon', 'Cache-Control': 'public, max-age=0, must-revalidate' },
  });
}
