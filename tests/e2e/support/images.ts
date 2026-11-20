/**
 * The image optimizer's addresses (/_next/image), shared by the warm-up before the first test
 * (../global-setup.ts) and the check on every test (./fixtures.ts).
 *
 * `next start` (Next 14.2.15) keeps one picture per cache key, and the key is four things: the
 * source (`url`), the width (`w`), the quality (`q`), and the format the request's Accept header
 * chooses among the build's image formats (validateParams and getCacheKey of ImageOptimizerCache,
 * in next/dist/server/image-optimizer.js). Two requests share a picture when those four agree,
 * however their addresses are written.
 */
import { imageConfigDefault } from 'next/dist/shared/lib/image-config';

/** The optimizer's path (next/image's default loader; next.config.mjs keeps it). */
export const OPTIMIZER = '/_next/image';

/** The Accept header Chrome sends for a picture, which the warm-up sends too. */
export const PICTURE_ACCEPT = 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8';

/** What the warm-up made: every source at every width and quality, all in one format. */
export interface WarmedImages {
  sources: string[];
  widths: number[];
  qualities: number[];
  /** The build's image formats, among which a request's Accept header chooses. */
  formats: string[];
  /** The format PICTURE_ACCEPT chooses among them, the one every warmed picture was made in. */
  format: string;
}

/** The build's image formats when the served build's images-manifest.json does not say. */
export const DEFAULT_FORMATS: string[] = [...imageConfigDefault.formats];

/**
 * The environment variable that carries the warm-up's list to the test workers: Playwright starts
 * them after the global setup, with the environment it left. The list is short (the factors, not
 * every address), so it stays far below the size an environment variable may have on Windows.
 */
const WARMED_LIST = 'E2E_WARMED_IMAGES';

/** Hands the warm-up's list to the test workers (../global-setup.ts calls it once all is warmed). */
export function publishWarmed(warmed: WarmedImages): void {
  process.env[WARMED_LIST] = JSON.stringify(warmed);
}

/** The warm-up's list, or null when no warm-up ran in this run. */
export function readWarmed(): WarmedImages | null {
  const text = process.env[WARMED_LIST];
  if (!text) return null;
  try {
    const list = JSON.parse(text) as Partial<WarmedImages>;
    const strings = (value: unknown) => Array.isArray(value) && value.every((item) => typeof item === 'string');
    const numbers = (value: unknown) => Array.isArray(value) && value.every((item) => Number.isInteger(item));
    if (strings(list.sources) && numbers(list.widths) && numbers(list.qualities) && strings(list.formats) && typeof list.format === 'string') {
      return list as WarmedImages;
    }
  } catch {
    // Not a list this file wrote: as if none.
  }
  return null;
}

/**
 * Next's own Accept negotiation, the one its image optimizer calls: a CommonJS file with no types,
 * so it is loaded with require (the suite runs as CommonJS, as __dirname in ../global-setup.ts
 * shows) and typed here.
 */
const { mediaType } = require('next/dist/compiled/@hapi/accept') as { mediaType(accept: string, preferences: string[]): string };

/**
 * The format the optimizer makes a picture in for a request with this Accept header, the way
 * getSupportedMimeType in next/dist/server/image-optimizer.js chooses it: one of the build's
 * formats, or '' for the source's own format.
 */
export function formatFor(accept: string | undefined, formats: string[]): string {
  const header = accept ?? '';
  const type = mediaType(header, formats);
  return header.includes(type) ? type : '';
}

/** A request's Accept header, and whether it is Chrome's own for that kind of request (assumed). */
export type RequestAccept = { value: string; assumed: boolean } | null;

/**
 * The Accept header a page's request carries, from what Playwright shows of it when the request is
 * sent. With routing on, Playwright shows the headers the request went out with. With no routing
 * (the console tests), it shows only those Chrome knew as the request began, and the ones it went
 * out with only once an answer comes, which a request that hangs never gets; Chrome adds its own
 * Accept header between the two, by the kind of request. So when none is shown, Chrome's own is
 * taken: PICTURE_ACCEPT for a picture, and the wildcard one (any type) for fetch() and
 * XMLHttpRequest, as Chrome sends them when the page sets none (a header the page sets is shown).
 * For any other kind, null: not known when the request is sent (an answer the server makes for it
 * is still named, as X-Nextjs-Cache: MISS).
 */
export function requestAccept(headers: Record<string, string>, resourceType: string): RequestAccept {
  if (headers.accept !== undefined) return { value: headers.accept, assumed: false };
  if (resourceType === 'image') return { value: PICTURE_ACCEPT, assumed: true };
  if (resourceType === 'fetch' || resourceType === 'xhr') return { value: '*/*', assumed: true };
  return null;
}

/** The address of one warmed picture, as next/image writes it. */
export function warmedAddress(warmed: WarmedImages, at: { source?: number; width?: number; quality?: number } = {}): string {
  const source = warmed.sources[at.source ?? 0];
  const width = warmed.widths[at.width ?? 0];
  const quality = warmed.qualities[at.quality ?? 0];
  return `${OPTIMIZER}?url=${encodeURIComponent(source)}&w=${width}&q=${quality}`;
}

/**
 * Why a request for this optimizer address, with this Accept header (requestAccept), asks for a
 * picture the warm-up did not make; null when it made it. The values are read as the optimizer
 * reads them (the source decoded, the width and quality as whole numbers). The format is judged
 * only when the Accept header is known.
 */
export function notWarmed(address: URL, accept: RequestAccept, warmed: WarmedImages): string | null {
  const source = address.searchParams.get('url');
  const width = Number.parseInt(address.searchParams.get('w') ?? '', 10);
  const quality = Number.parseInt(address.searchParams.get('q') ?? '', 10);
  const missed: string[] = [];
  if (source === null || !warmed.sources.includes(source)) missed.push(`source ${source ?? '(none)'} not warmed`);
  if (!warmed.widths.includes(width)) missed.push(`width ${address.searchParams.get('w') ?? '(none)'} not warmed`);
  if (!warmed.qualities.includes(quality)) missed.push(`quality ${address.searchParams.get('q') ?? '(none)'} not warmed`);
  const format = accept === null ? warmed.format : formatFor(accept.value, warmed.formats);
  if (accept !== null && format !== warmed.format) {
    const own = "the source's own format";
    const header = `Accept ${JSON.stringify(accept.value)}${accept.assumed ? " (Chrome's own for this kind of request)" : ''}`;
    missed.push(`${header} asks for ${format || own}, and the warm-up made ${warmed.format || own}`);
  }
  return missed.length > 0 ? missed.join('; ') : null;
}
