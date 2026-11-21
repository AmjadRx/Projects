/**
 * The font files every page preloads (app/layout.tsx): Archivo's core file and B612 Mono's regular
 * core file, which first views set text in. Written by scripts/subset-fonts.py with the files in
 * public/fonts/ and the @font-face rules in app/fonts.css: change that script, not this file.
 */
export const FONT_PRELOADS = [
  '/fonts/archivo-core.2a7f94abc8.woff2',
  '/fonts/b612-mono-regular-core.941ff1094a.woff2',
] as const;
