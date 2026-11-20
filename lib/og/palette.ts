/**
 * The Blueprint colors the images and the icon are drawn in, read from app/tokens.css through
 * lib/tokens.ts (the one file with color values). A token that cannot be read stops the build
 * with its name: an image in the wrong colors would ship silently.
 */
import 'server-only';
import { tokenValue } from '../tokens';

/** The tokens the sheet uses, by their names in app/tokens.css. */
const NAMES = {
  sheet: 'sheet',
  ink: 'ink',
  inkDim: 'ink-dim',
  inkMute: 'ink-mute',
  line: 'line',
  rule: 'rule',
  gridMinor: 'grid-minor',
  gridMajor: 'grid-major',
  glass: 'glass',
} as const;

/** The thermal ramp, cold to hot (DESIGN_DIRECTION.md 2.3), drawn only in the Open Graph images (2.4, place 6). */
const RAMP = ['t0', 't1', 't2', 't3', 't4', 't5', 't6'] as const;

export type Palette = { [K in keyof typeof NAMES]: string } & { ramp: string[] };

function read(name: string): string {
  const value = tokenValue(name, 'blueprint');
  if (!value) throw new Error(`Open Graph images: the token --${name} could not be read from app/tokens.css`);
  return value;
}

let cached: Palette | null = null;

export function blueprintPalette(): Palette {
  if (cached) return cached;
  const colors = Object.fromEntries(Object.entries(NAMES).map(([key, name]) => [key, read(name)])) as { [K in keyof typeof NAMES]: string };
  cached = { ...colors, ramp: RAMP.map(read) };
  return cached;
}
