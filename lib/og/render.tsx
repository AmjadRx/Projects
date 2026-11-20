/**
 * The images themselves, for the routes: an Open Graph card, and the site icon at any size. Both
 * are drawn by next/og's ImageResponse with the site's own fonts and Blueprint colors, once, at
 * build time (each route is static).
 */
import 'server-only';
import { ImageResponse } from 'next/og';
import { initials, OG_HEIGHT, OG_WIDTH, type Card } from './cards';
import { face, rendererFonts } from './fonts';
import { pathData, textOutline } from './font/outline';
import { blueprintPalette } from './palette';
import { ogReady } from './runtime';
import { cardElement, cardFaces } from './sheet';

export const OG_SIZE = { width: OG_WIDTH, height: OG_HEIGHT };

export async function cardImage(card: Card): Promise<ImageResponse> {
  await ogReady();
  return new ImageResponse(cardElement(card, blueprintPalette()), { ...OG_SIZE, fonts: rendererFonts(cardFaces(card)) });
}

/** The face the icon sets the initials in: the display face, at the weight and width of the project titles. */
const ICON_FACE = 'title';

/** How much of the icon the letters may fill: their ink's width, and their ink's height. */
const ICON_FILL = { width: 0.76, height: 0.56 };

/**
 * The site icon (docs/V3_PLAN.md Q-42): the owner's initials in the display face, in the line
 * color on the Blueprint sheet, and nothing else. The letters are drawn from the font's own
 * outlines and centered on their ink, so they sit in the middle at every size.
 */
export async function iconImage(size: number, name: string): Promise<ImageResponse> {
  await ogReady();
  const palette = blueprintPalette();
  const letters = initials(name);
  let d = '';
  if (letters) {
    const outline = textOutline(face(ICON_FACE).font, letters);
    const [x0, y0, x1, y1] = outline.box;
    const scale = Math.min((size * ICON_FILL.width) / (x1 - x0), (size * ICON_FILL.height) / (y1 - y0));
    d = pathData(outline, scale, (size - (x1 - x0) * scale) / 2 - x0 * scale, (size - (y1 - y0) * scale) / 2 - y0 * scale);
  }
  return new ImageResponse(
    (
      <div style={{ display: 'flex', width: size, height: size, backgroundColor: palette.sheet }}>
        {d ? (
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
            <path d={d} fill={palette.line} />
          </svg>
        ) : null}
      </div>
    ),
    { width: size, height: size },
  );
}

/**
 * /favicon.ico as an icon file holding the icon as PNG images (16, 32, and 48 px), which every
 * current browser reads. Clients that ask for /favicon.ico without reading the page's icon link
 * get the same mark instead of a 404.
 */
export async function faviconIco(name: string, sizes: readonly number[] = [16, 32, 48]): Promise<Uint8Array<ArrayBuffer>> {
  const pngs = await Promise.all(sizes.map(async (size) => new Uint8Array(await (await iconImage(size, name)).arrayBuffer())));
  const header = 6 + 16 * pngs.length;
  const total = header + pngs.reduce((sum, png) => sum + png.byteLength, 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint16(0, 0, true);
  view.setUint16(2, 1, true);
  view.setUint16(4, pngs.length, true);
  let offset = header;
  pngs.forEach((png, i) => {
    const entry = 6 + i * 16;
    out[entry] = sizes[i] >= 256 ? 0 : sizes[i];
    out[entry + 1] = sizes[i] >= 256 ? 0 : sizes[i];
    view.setUint16(entry + 4, 1, true);
    view.setUint16(entry + 6, 32, true);
    view.setUint32(entry + 8, png.byteLength, true);
    view.setUint32(entry + 12, offset, true);
    out.set(png, offset);
    offset += png.byteLength;
  });
  return out;
}
