/**
 * Token values read from app/tokens.css, the one file that holds color values (ARCHITECTURE.md 2),
 * for the few places that need a literal color rather than a CSS variable: the browser's theme
 * color now, and later the Open Graph images and the viewers' materials. Read once at build time;
 * a token that cannot be read is undefined, and the caller leaves its use out.
 */
import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import type { Theme } from './theme';

type Table = Record<string, string>;

let tables: Record<Theme, Table> | null | undefined;

function read(): Record<Theme, Table> | null {
  try {
    const css = fs.readFileSync(path.join(process.cwd(), 'app', 'tokens.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const base: Table = {};
    const white: Table = {};
    for (const block of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = block[1].trim();
      const target = /whiteprint/.test(selector) ? white : /^:root\b|\[data-theme="blueprint"\]/.test(selector) ? base : null;
      if (!target) continue;
      for (const decl of block[2].matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) target[decl[1]] = decl[2].trim();
    }
    return { blueprint: base, whiteprint: { ...base, ...white } };
  } catch {
    return null;
  }
}

/** A token's value in a theme, with `var(--other)` references followed. */
export function tokenValue(name: string, theme: Theme): string | undefined {
  if (tables === undefined) tables = read();
  const table = tables?.[theme];
  if (!table) return undefined;
  let value = table[name];
  for (let hops = 0; value && hops < 8; hops += 1) {
    const ref = /^var\(--([\w-]+)\)$/.exec(value);
    if (!ref) return value;
    value = table[ref[1]];
  }
  return undefined;
}
