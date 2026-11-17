import { describe, expect, it, vi } from 'vitest';

// lib/highlight.ts is marked server-only; outside a React server build that marker throws.
vi.mock('server-only', () => ({}));

import { highlightCode, normalizeCode, type HighlightedCode } from '../lib/highlight';

/** The code a result shows, rebuilt from its tokens. */
function textOf(result: HighlightedCode): string {
  return result.lines.map((line) => line.map((token) => token.text).join('')).join('\n');
}

function colorsOf(result: HighlightedCode): string[] {
  return result.lines.flatMap((line) => line.flatMap((token) => (token.color ? [token.color] : [])));
}

const TS = 'export function clamp(value: number, min: number, max: number): number {\n  return Math.min(max, Math.max(min, value)); // keep it in range\n}\n';

describe('normalizeCode', () => {
  it('turns Windows and old Mac line endings into newlines', () => {
    expect(normalizeCode('a\r\nb\rc')).toBe('a\nb\nc');
  });

  it('drops blank lines at the start and white space at the end, and keeps indentation', () => {
    expect(normalizeCode('\n   \n  if (x) {\n    y();\n  }\n\n  \n')).toBe('  if (x) {\n    y();\n  }');
  });
});

describe('highlightCode', () => {
  it('highlights a known language with colors from the --shiki-* variables only', async () => {
    const result = await highlightCode(TS, 'ts');
    expect(result.highlighted).toBe(true);
    expect(result.lang).toBe('typescript');
    expect(result.languageName).toBe('TypeScript');
    const colors = colorsOf(result);
    expect(colors).toContain('var(--shiki-token-keyword)');
    expect(colors).toContain('var(--shiki-token-comment)');
    for (const color of colors) expect(color).toMatch(/^var\(--shiki-[a-z-]+\)$/);
  });

  it('gives back exactly the code it was given, token by token', async () => {
    const samples: [string, string][] = [
      [TS, 'typescript'],
      ['def area(r):\n\treturn 3.14159 * r ** 2\n', 'python'],
      ['#include <stdio.h>\nint main(void) { printf("%d\\n", 42); }', 'c'],
      ['module blink(input clk, output reg led);\n  always @(posedge clk) led <= ~led;\nendmodule', 'verilog'],
      ['{ "a": [1, 2, 3], "b": null }', 'json'],
    ];
    for (const [code, language] of samples) {
      const result = await highlightCode(code, language);
      expect(result.highlighted).toBe(true);
      expect(textOf(result)).toBe(normalizeCode(code));
    }
  });

  it('reads the language without regard to case or surrounding spaces', async () => {
    const result = await highlightCode('let x = 1', '  TypeScript ');
    expect(result.lang).toBe('typescript');
    expect(result.languageName).toBe('TypeScript');
  });

  it('accepts the highlighter aliases and a few common extras', async () => {
    expect((await highlightCode('int x;', 'c++')).lang).toBe('cpp');
    expect((await highlightCode('x = 1', 'py')).languageName).toBe('Python');
    expect((await highlightCode('logic a;', 'sv')).lang).toBe('system-verilog');
    const sketch = await highlightCode('void setup() {}', 'arduino');
    expect(sketch.lang).toBe('cpp');
    expect(sketch.languageName).toBe('Arduino');
  });

  it('falls back to plain text for a language the highlighter lacks, and never throws', async () => {
    const code = 'A line of text.\n  An indented line.';
    const result = await highlightCode(code, 'not-a-language');
    expect(result.highlighted).toBe(false);
    expect(result.lang).toBe('text');
    expect(result.languageName).toBe('not-a-language');
    expect(colorsOf(result)).toEqual([]);
    expect(textOf(result)).toBe(code);
  });

  it('treats odd language values as plain text', async () => {
    for (const language of ['c(++', '../../etc', 'constructor', '__proto__', '\u0000']) {
      const result = await highlightCode('x', language);
      expect(result.highlighted).toBe(false);
      expect(textOf(result)).toBe('x');
    }
  });

  it('prints no language name for plain text asked for on purpose', async () => {
    for (const language of ['', 'text', 'TXT', 'plaintext']) {
      const result = await highlightCode('just words', language);
      expect(result.highlighted).toBe(false);
      expect(result.languageName).toBe('');
    }
  });

  it('keeps markup in the code as text', async () => {
    const code = '<script>alert("x")</script>';
    expect(textOf(await highlightCode(code, 'html'))).toBe(code);
    expect(textOf(await highlightCode(code, 'nope'))).toBe(code);
  });

  it('handles many blocks of a new language at once', async () => {
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => highlightCode(`fn f${i}() {}`, 'rust')));
    for (const [i, result] of results.entries()) {
      expect(result.highlighted).toBe(true);
      expect(textOf(result)).toBe(`fn f${i}() {}`);
    }
  });
});
