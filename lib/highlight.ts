/**
 * Code highlighting at build time (ARCHITECTURE.md 13A, "Code"). Shiki runs only on the server
 * while pages are prerendered (next.config.mjs keeps it out of every bundle), so no highlighter
 * ever reaches a browser. It uses the css-variables theme: every color is a `--shiki-*` variable,
 * and app/globals.css sets those for both themes (docs/V3_PLAN.md 4.2).
 *
 * A language the highlighter lacks falls back to plain text, and so does any highlighter
 * failure: a typo in a code block can never fail the build (docs/V3_PLAN.md D-05).
 */
import 'server-only';
import type { BundledLanguage, Highlighter, ThemedToken } from 'shiki';

const THEME_NAME = 'css-variables';

/** One run of text with one style. */
export interface CodeToken {
  text: string;
  /** A CSS color, always a `--shiki-*` variable. Absent means the block's foreground color. */
  color?: string;
  italic?: boolean;
  bold?: boolean;
  underline?: boolean;
  strike?: boolean;
}

export interface HighlightedCode {
  /**
   * The lines, each a list of tokens. Joining every token's text, with a newline between lines,
   * gives back the code exactly as `normalizeCode` returns it.
   */
  lines: CodeToken[][];
  /** The highlighter's language id ("typescript"), or "text" for plain text. */
  lang: string;
  /**
   * The name to print in the caption: the language's display name ("TypeScript"); for a
   * language the highlighter lacks, the content's own value as typed; '' for plain text.
   */
  languageName: string;
  /** False when the code is shown as plain text. */
  highlighted: boolean;
}

/** Values that ask for plain text on purpose. */
const PLAIN_TEXT = new Set(['', 'text', 'txt', 'plain', 'plaintext']);

/** Common names the highlighter does not list, mapped to the grammar that reads them. */
const EXTRA_ALIASES: Record<string, { id: string; name: string }> = {
  systemverilog: { id: 'system-verilog', name: 'SystemVerilog' },
  sv: { id: 'system-verilog', name: 'SystemVerilog' },
  arduino: { id: 'cpp', name: 'Arduino' },
  ino: { id: 'cpp', name: 'Arduino' },
  h: { id: 'c', name: 'C' },
  hpp: { id: 'cpp', name: 'C++' },
  hh: { id: 'cpp', name: 'C++' },
  cc: { id: 'cpp', name: 'C++' },
  cxx: { id: 'cpp', name: 'C++' },
};

/**
 * The code as the block shows it: line endings as newlines, with blank lines at the start and
 * trailing white space at the end removed. Indentation inside the code is kept.
 */
export function normalizeCode(code: string): string {
  return code
    .replace(/\r\n?/g, '\n')
    .replace(/^(?:[ \t]*\n)+/, '')
    .replace(/\s+$/, '');
}

function plainLines(code: string): CodeToken[][] {
  return code.split('\n').map((line) => (line === '' ? [] : [{ text: line }]));
}

// ---------------------------------------------------------------------------------------------
// The highlighter: one per server process, created on first use
// ---------------------------------------------------------------------------------------------

type ShikiModule = typeof import('shiki');

interface Engine {
  highlighter: Highlighter;
  /** Lower-case id or alias to the grammar id and its display name. */
  languages: Map<string, { id: string; name: string }>;
}

interface EngineStore {
  engine?: Promise<Engine>;
  loads: Map<string, Promise<void>>;
}

// Kept on globalThis so a module reload in development reuses the same highlighter.
const STORE_KEY = Symbol.for('amjadrehawi.highlight');
const store: EngineStore = ((globalThis as Record<symbol, unknown>)[STORE_KEY] as EngineStore | undefined) ?? {
  loads: new Map(),
};
(globalThis as Record<symbol, unknown>)[STORE_KEY] = store;

function languageIndex(shiki: ShikiModule): Map<string, { id: string; name: string }> {
  const index = new Map<string, { id: string; name: string }>();
  for (const info of shiki.bundledLanguagesInfo) {
    const entry = { id: info.id, name: info.name };
    index.set(info.id.toLowerCase(), entry);
    for (const alias of info.aliases ?? []) index.set(alias.toLowerCase(), entry);
  }
  for (const [alias, entry] of Object.entries(EXTRA_ALIASES)) {
    if (!index.has(alias) && index.has(entry.id)) index.set(alias, entry);
  }
  return index;
}

function engine(): Promise<Engine> {
  if (!store.engine) {
    const created = (async () => {
      const shiki = await import('shiki');
      const theme = shiki.createCssVariablesTheme({ name: THEME_NAME, variablePrefix: '--shiki-', fontStyle: true });
      const highlighter = await shiki.createHighlighter({ themes: [theme], langs: [] });
      return { highlighter, languages: languageIndex(shiki) };
    })();
    store.engine = created;
    // A failed start is not kept, so the next code block tries again.
    created.catch(() => {
      if (store.engine === created) store.engine = undefined;
    });
  }
  return store.engine;
}

function ensureLanguage(highlighter: Highlighter, id: string): Promise<void> {
  if (highlighter.getLoadedLanguages().includes(id)) return Promise.resolve();
  let load = store.loads.get(id);
  if (!load) {
    load = highlighter.loadLanguage(id as BundledLanguage);
    store.loads.set(id, load);
    load.catch(() => store.loads.delete(id));
  }
  return load;
}

// ---------------------------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------------------------

/** Only the theme's own variables (or a plain hex value) may become an inline color. */
const SAFE_COLOR = /^(?:var\(--shiki-[a-z0-9-]+\)|#[0-9a-f]{3,8})$/i;
const FOREGROUND = 'var(--shiki-foreground)';

// Shiki's FontStyle bit flags.
const ITALIC = 1;
const BOLD = 2;
const UNDERLINE = 4;
const STRIKE = 8;

function toToken(token: ThemedToken): CodeToken {
  const out: CodeToken = { text: token.content };
  const color = token.color;
  if (color && color !== FOREGROUND && SAFE_COLOR.test(color)) out.color = color;
  const style = token.fontStyle ?? 0;
  if (style > 0) {
    if (style & ITALIC) out.italic = true;
    if (style & BOLD) out.bold = true;
    if (style & UNDERLINE) out.underline = true;
    if (style & STRIKE) out.strike = true;
  }
  return out;
}

function sameStyle(a: CodeToken, b: CodeToken): boolean {
  return a.color === b.color && a.italic === b.italic && a.bold === b.bold && a.underline === b.underline && a.strike === b.strike;
}

/** Merges neighboring tokens that look the same, so the page carries fewer elements. */
function toLine(tokens: ThemedToken[]): CodeToken[] {
  const out: CodeToken[] = [];
  for (const token of tokens) {
    if (token.content === '') continue;
    const next = toToken(token);
    const last = out[out.length - 1];
    if (last && sameStyle(last, next)) last.text += next.text;
    else out.push(next);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// The public function
// ---------------------------------------------------------------------------------------------

/**
 * Highlights code for the code block. Never throws: an unknown language, a grammar that fails to
 * load, or a highlighter that fails to start all give plain text.
 */
export async function highlightCode(code: string, language: string): Promise<HighlightedCode> {
  const text = normalizeCode(code);
  const typed = language.trim();
  const key = typed.toLowerCase();
  const plain = (languageName: string): HighlightedCode => ({
    lines: plainLines(text),
    lang: 'text',
    languageName,
    highlighted: false,
  });

  if (PLAIN_TEXT.has(key)) return plain('');

  let loaded: Engine;
  try {
    loaded = await engine();
  } catch {
    return plain(typed);
  }

  const match = loaded.languages.get(key);
  if (!match) return plain(typed);

  try {
    await ensureLanguage(loaded.highlighter, match.id);
    const result = loaded.highlighter.codeToTokens(text, { lang: match.id as BundledLanguage, theme: THEME_NAME });
    const lines = result.tokens.map(toLine);
    // Shiki splits lines the same way; anything else means the tokens cannot be trusted.
    if (lines.map((line) => line.map((t) => t.text).join('')).join('\n') !== text) return plain(match.name);
    return { lines, lang: match.id, languageName: match.name, highlighted: true };
  } catch {
    return plain(match.name);
  }
}
