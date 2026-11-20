/**
 * The thermal ramp appears only in the eight places of DESIGN_DIRECTION.md 2.4 (ARCHITECTURE.md
 * 15, item 5; CLAUDE.md, "Code conventions"). Anywhere else it is a bug.
 *
 * The test finds every use of the ramp in the site's code, app/ (every stylesheet and every
 * script), components/ and lib/, and pins each one to one of the eight places through the list
 * below. A use is:
 *
 * - in a stylesheet, a rule that names one of the ramp's stops (`var(--t0)` to `var(--t6)`, even one
 *   alone: the hero's thermal layer fills each shape with a single stop), any `--heat*` variable,
 *   a custom property that carries the ramp, or the ramp's SVG gradient stops (the `hm-s0` to
 *   `hm-s9` classes);
 * - in a script, code that names the ramp: the stops' names (`--t3`, a computed `--t${i}`, or the
 *   token names `t0` to `t6`), a `--heat*` variable, the `hm-s*` gradient stops, the `ramp` of the
 *   model viewer's thermal palette and of the Open Graph renderer, or the thermal shader's `ramp()`
 *   and `uStops`. Comments are not code.
 *
 * Each use is named by its file and its selector (a stylesheet) or its top-level symbol (a script:
 * the function, constant, interface or class member it sits in). The ramp's token definitions are
 * not uses: the stops and the action color in app/tokens.css, and the four gradients in
 * app/sheet.css's page frame; they are pinned too, so a definition anywhere else is caught. The
 * action color (`--action`, the amber stop) is the one stop used alone everywhere, by design
 * (DESIGN_DIRECTION.md 2.3); a use of `var(--action)` is not a use of the ramp.
 *
 * The test fails on any use that is not on the list, naming the file, the selector or symbol and
 * DESIGN_DIRECTION.md 2.4, and on any listed entry that is no longer found. The admin's stylesheets
 * and code hold no ramp at all. app/print.css adds none (the printed page shows the screen's
 * maturity scale only: tests/e2e/print.spec.ts checks the printed result).
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..');

type Place = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/** DESIGN_DIRECTION.md 2.4, the complete list of eight. */
const PLACES: Record<Place, string> = {
  1: 'the hero thermal lens (DESIGN_DIRECTION.md 6.1)',
  2: 'the maturity scale on project cards and project pages (5.3)',
  3: 'the heat rule under the nav',
  4: 'the roadmap block, its stages filled up to the current one',
  5: "the primary button's hover sweep",
  6: 'the generated Open Graph images',
  7: 'the dawn on the horizon of the sky background',
  8: "the thermal view of the 3D model viewer",
};

interface Pin {
  /** The file, from the repository root, with forward slashes. */
  file: string;
  /** The selector of a stylesheet rule (white space collapsed), or a script's top-level symbol. */
  at: string;
  place: Place;
}

/** Every use of the ramp, pinned to its place. */
const RAMP_USES: Pin[] = [
  // 1. The hero thermal lens: the drawing's thermal layer, the same geometry filled with the ramp,
  //    and its radial gradients (components/home/hero/RavenDrawing.tsx draws the stops by class).
  { file: 'app/motion-drawing.css', at: '.hm-th-wing', place: 1 },
  { file: 'app/motion-drawing.css', at: '.hm-th-nac', place: 1 },
  { file: 'app/motion-drawing.css', at: '.hm-th-fus', place: 1 },
  { file: 'app/motion-drawing.css', at: '.hm-th-cable', place: 1 },
  { file: 'app/motion-drawing.css', at: '.hm-th-disc', place: 1 },
  { file: 'app/motion-drawing.css', at: '.hm-s0', place: 1 },
  { file: 'app/motion-drawing.css', at: '.hm-s3', place: 1 },
  { file: 'app/motion-drawing.css', at: '.hm-s4', place: 1 },
  { file: 'app/motion-drawing.css', at: '.hm-s5', place: 1 },
  { file: 'app/motion-drawing.css', at: '.hm-s6', place: 1 },
  { file: 'components/home/hero/RavenDrawing.tsx', at: 'RavenDrawing', place: 1 },
  // 2. The maturity scale (components/sheet/MaturityScale.tsx draws the cells).
  { file: 'app/sheet.css', at: '.ar-ms__heat', place: 2 },
  // 3. The heat rule (components/site/HeatRule.tsx): its box, as tall as --heat-rule-height, and the ramp.
  { file: 'app/motion-chrome.css', at: '.ar-heat', place: 3 },
  { file: 'app/motion-chrome.css', at: '.ar-heat__fill', place: 3 },
  // 4. The roadmap (components/sheet/Roadmap.tsx), stacked on phones and across from 768 px.
  { file: 'app/sheet.css', at: '.ar-road__heat', place: 4 },
  // 5. The primary button's sweep (components/sheet/Button.tsx).
  { file: 'app/sheet.css', at: '.ar-btn__sweep', place: 5 },
  // 6. The Open Graph images: the stops read from app/tokens.css, the heat rule under the frame,
  //    and the maturity scale's cells.
  { file: 'lib/og/palette.ts', at: 'RAMP', place: 6 },
  { file: 'lib/og/palette.ts', at: 'Palette', place: 6 },
  { file: 'lib/og/palette.ts', at: 'blueprintPalette', place: 6 },
  { file: 'lib/og/sheet.tsx', at: 'SheetLayer', place: 6 },
  { file: 'lib/og/sheet.tsx', at: 'MaturityCells', place: 6 },
  // 7. The dawn on the horizon (components/sky/Sky.tsx draws the layer; the live scene draws none).
  { file: 'app/sheet.css', at: '.ar-sky__dawn', place: 7 },
  // 8. The model viewer's Thermal view: the stops read from the page, and the shader that maps a
  //    surface onto them. The hero model's lens shows the same Thermal view through its circle
  //    (components/viewers/model/lensPass.ts), with no ramp of its own.
  { file: 'components/viewers/model/palette.ts', at: 'ModelPalette', place: 8 },
  { file: 'components/viewers/model/palette.ts', at: 'readPalette', place: 8 },
  { file: 'components/viewers/model/palette.ts', at: 'samePalette', place: 8 },
  { file: 'components/viewers/model/materials.ts', at: 'THERMAL_FRAGMENT', place: 8 },
  { file: 'components/viewers/model/materials.ts', at: 'setThermalStops', place: 8 },
  { file: 'components/viewers/model/materials.ts', at: 'createThermalMaterial', place: 8 },
  { file: 'components/viewers/model/rig.ts', at: 'ModelRig.setPalette', place: 8 },
];

/** The ramp's token definitions: not uses, and found nowhere else. */
const RAMP_DEFINITIONS: Omit<Pin, 'place'>[] = [
  // The seven stops, and the action color, which is the amber stop in Blueprint.
  { file: 'app/tokens.css', at: ':root, [data-theme="blueprint"]' },
  // --heat, --heat-scale, --heat-scale-v and --heat-sweep, on the page frame.
  { file: 'app/sheet.css', at: '.ar-frame' },
];

// ---------------------------------------------------------------------------------------------
// The scanner
// ---------------------------------------------------------------------------------------------

interface CssRule {
  /** The selector (or a keyframe's step), white space collapsed. */
  selector: string;
  /** The at-rules around it, outermost first. */
  context: string[];
  declarations: { property: string; value: string }[];
  /** The line its selector starts on. */
  line: number;
}

/** Comments as spaces, keeping every line break, so positions and line numbers stay. */
function blankComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));
}

const squash = (text: string) => text.replace(/\s+/g, ' ').trim();

/** The rules of a stylesheet, at any depth of at-rules, with their declarations. */
function parseCss(source: string): CssRule[] {
  const css = blankComments(source);
  const rules: CssRule[] = [];
  const frames: { prelude: string; body: string; line: number }[] = [{ prelude: '', body: '', line: 1 }];
  let line = 1;
  let quote: string | null = null;
  let depth = 0;
  for (let i = 0; i < css.length; i += 1) {
    const c = css[i];
    const top = frames[frames.length - 1];
    if (c === '\n') line += 1;
    if (quote) {
      top.body += c;
      if (c === quote && css[i - 1] !== '\\') quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      top.body += c;
      continue;
    }
    if (c === '(') depth += 1;
    if (c === ')') depth = Math.max(0, depth - 1);
    if (c === '{' && depth === 0) {
      // The prelude is what follows the last declaration (or the block's start).
      const cut = top.body.lastIndexOf(';') + 1;
      const prelude = top.body.slice(cut);
      const start = prelude.length - prelude.trimStart().length;
      const preludeLine = line - (prelude.slice(start).match(/\n/g)?.length ?? 0);
      top.body = top.body.slice(0, cut);
      frames.push({ prelude: squash(prelude), body: '', line: preludeLine });
      continue;
    }
    if (c === '}' && depth === 0 && frames.length > 1) {
      const done = frames.pop()!;
      const declarations = done.body
        .split(';')
        .map((part) => part.trim())
        .filter((part) => part.includes(':'))
        .map((part) => {
          const colon = part.indexOf(':');
          return { property: part.slice(0, colon).trim(), value: squash(part.slice(colon + 1)) };
        })
        .filter((d) => /^[-\w]+$/.test(d.property));
      if (declarations.length > 0) {
        rules.push({ selector: done.prelude, context: frames.slice(1).map((f) => f.prelude), declarations, line: done.line });
      }
      continue;
    }
    top.body += c;
  }
  return rules;
}

/** The token that is the action color: the amber stop, used alone everywhere by design. */
const ACTION = '--action';

const STOP_DEF = /^--t[0-6]$/;
const STOP_REF = /var\(\s*--t([0-6])\s*[,)]/g;
const HEAT_REF = /var\(\s*(--heat[\w-]*)\s*[,)]/g;
const VAR_REF = /var\(\s*(--[\w-]+)\s*[,)]/g;
const GRADIENT_STOP_CLASS = /\.hm-s\d\b/;

/** What a value says about the ramp: the stops, the --heat* variables, and the carriers it names. */
function rampRefs(value: string, carriers: Set<string>): string[] {
  const found = new Set<string>();
  for (const m of value.matchAll(STOP_REF)) found.add(`--t${m[1]}`);
  for (const m of value.matchAll(HEAT_REF)) found.add(m[1]);
  for (const m of value.matchAll(VAR_REF)) if (carriers.has(m[1])) found.add(m[1]);
  return [...found].sort();
}

/**
 * The custom properties that carry the ramp, from every stylesheet: each defined from a stop, a
 * --heat* variable, or another carrier (followed to a fixed point). The stops themselves and the
 * action color are not carriers.
 */
function rampCarriers(sheets: CssRule[][]): Set<string> {
  const carriers = new Set<string>();
  for (let changed = true; changed; ) {
    changed = false;
    for (const rules of sheets) {
      for (const rule of rules) {
        for (const { property, value } of rule.declarations) {
          if (!property.startsWith('--') || STOP_DEF.test(property) || property === ACTION || carriers.has(property)) continue;
          if (rampRefs(value, carriers).length > 0) {
            carriers.add(property);
            changed = true;
          }
        }
      }
    }
  }
  return carriers;
}

interface Found {
  file: string;
  at: string;
  kind: 'use' | 'definition';
  /** What it names of the ramp, for the message. */
  what: string[];
  line: number;
}

/** The ramp in one stylesheet's rules: its uses and its token definitions, one entry per rule. */
function cssFindings(file: string, rules: CssRule[], carriers: Set<string>): Found[] {
  const out: Found[] = [];
  for (const rule of rules) {
    const used = new Set<string>();
    const defined = new Set<string>();
    for (const { property, value } of rule.declarations) {
      const refs = rampRefs(value, carriers);
      if (property.startsWith('--')) {
        if (STOP_DEF.test(property)) defined.add(property);
        else if (refs.length > 0) defined.add(property === ACTION ? ACTION : `${property}: ${refs.join(' ')}`);
      } else {
        for (const ref of refs) used.add(ref);
      }
    }
    if (GRADIENT_STOP_CLASS.test(rule.selector)) used.add('an hm-s gradient stop');
    const at = rule.context.some((c) => c.startsWith('@keyframes')) ? `${rule.context.join(' ')} ${rule.selector}` : rule.selector;
    if (used.size > 0) out.push({ file, at, kind: 'use', what: [...used].sort(), line: rule.line });
    else if (defined.size > 0) out.push({ file, at, kind: 'definition', what: [...defined].sort(), line: rule.line });
  }
  return out;
}

/** Code that names the ramp (see the top of this file). */
const CODE_NAMES = new Set(['ramp', 'RAMP', 'uStops']);

function textRamp(text: string): string[] {
  const found: string[] = [];
  if (/--t[0-6](?![\w-])/.test(text)) found.push('a stop by name');
  if (/--t\$\{\}/.test(text)) found.push('a stop by a computed name');
  if (/--heat/.test(text)) found.push('a --heat variable');
  if (/\bhm-s\d\b/.test(text)) found.push('an hm-s gradient stop');
  if (/^t[0-6]$/.test(text)) found.push("a stop's token name");
  if (/\bramp\s*\(|\buStops\b/.test(text)) found.push('the thermal shader');
  return found;
}

/** The top-level symbol a node sits in: a function, a constant, a type, or a class and its member. */
function symbolOf(node: ts.Node): string {
  let member: ts.Node | null = null;
  let current: ts.Node = node;
  while (current.parent && !ts.isSourceFile(current.parent)) {
    if (ts.isClassElement(current) && ts.isClassLike(current.parent)) member = current;
    current = current.parent;
  }
  const named = (n: ts.Node): string | null => {
    const name = (n as { name?: ts.Node }).name;
    return name && ts.isIdentifier(name) ? name.text : null;
  };
  if (ts.isVariableStatement(current)) {
    const declaration = current.declarationList.declarations.find((d) => d.pos <= node.pos && node.end <= d.end) ?? current.declarationList.declarations[0];
    return declaration && ts.isIdentifier(declaration.name) ? declaration.name.text : '(a variable)';
  }
  if (ts.isClassDeclaration(current)) {
    const cls = named(current) ?? 'default';
    const memberName = member ? named(member) : null;
    return memberName ? `${cls}.${memberName}` : cls;
  }
  if (ts.isExportAssignment(current)) return 'default';
  return named(current) ?? `(top level, line ${current.getSourceFile().getLineAndCharacterOfPosition(current.getStart()).line + 1})`;
}

/** The ramp in one script: one entry per top-level symbol that names it. */
function codeFindings(file: string, text: string): Found[] {
  if (!/--t|--heat|hm-s\d|\bramp\b|\bRAMP\b|uStops|['"`]t[0-6]['"`]/.test(text)) return [];
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : file.endsWith('.ts') ? ts.ScriptKind.TS : file.endsWith('.jsx') ? ts.ScriptKind.JSX : ts.ScriptKind.JS;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const bySymbol = new Map<string, Found>();
  const note = (node: ts.Node, what: string[]) => {
    if (what.length === 0) return;
    const at = symbolOf(node);
    const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
    const entry = bySymbol.get(at) ?? { file, at, kind: 'use' as const, what: [], line };
    for (const w of what) if (!entry.what.includes(w)) entry.what.push(w);
    bySymbol.set(at, entry);
  };
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) note(node, textRamp(node.text));
    else if (ts.isTemplateExpression(node)) note(node, textRamp(node.head.text + node.templateSpans.map((span) => `\${}${span.literal.text}`).join('')));
    else if (ts.isJsxText(node)) note(node, textRamp(node.text));
    else if (ts.isIdentifier(node) && CODE_NAMES.has(node.text)) note(node, [`\`${node.text}\``]);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return [...bySymbol.values()].map((entry) => ({ ...entry, what: entry.what.sort() }));
}

/** Every file under a folder of the repository, relative to the root with forward slashes. */
function filesUnder(folder: string, pattern: RegExp): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.next')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (pattern.test(entry.name)) out.push(path.relative(ROOT, full).split(path.sep).join('/'));
    }
  };
  walk(path.join(ROOT, folder));
  return out.sort();
}

const read = (file: string) => fs.readFileSync(path.join(ROOT, file), 'utf8');

const FOLDERS = ['app', 'components', 'lib'];
const STYLESHEETS = FOLDERS.flatMap((folder) => filesUnder(folder, /\.css$/));
const SCRIPTS = FOLDERS.flatMap((folder) => filesUnder(folder, /\.(tsx?|jsx?|mjs|cjs)$/));

/** Every use and definition of the ramp in the site's code. */
function scanSite(): Found[] {
  const parsed = STYLESHEETS.map((file) => ({ file, rules: parseCss(read(file)) }));
  const carriers = rampCarriers(parsed.map((p) => p.rules));
  return [
    ...parsed.flatMap(({ file, rules }) => cssFindings(file, rules, carriers)),
    ...SCRIPTS.flatMap((file) => codeFindings(file, read(file))),
  ];
}

const key = (file: string, at: string) => `${file} ${at}`;
const isAdmin = (file: string) => /^(app\/admin|components\/admin|lib\/admin)\//.test(file);

describe('the scanner (shown what it must find, and what it must not)', () => {
  it('finds every kind of use in a stylesheet, and treats token definitions apart', () => {
    const css = `
      /* var(--t1) var(--t2) in a comment is not a use */
      :root { --t3: #c2379c; --action: var(--t5); --local: linear-gradient(var(--t1), var(--t2)); }
      .two { background-image: linear-gradient(var(--t1), var(--t2)); }
      .one { fill: var(--t4); }
      .heat { background-image: var(--heat-sweep); }
      .carried { background: var(--local); }
      .stop.hm-s7 { opacity: 1; }
      .action { background-color: var(--action); color: var(--ink); }
      @media (min-width: 768px) { .nested { border-image: var(--heat) 1; } }
      @keyframes glow { from { background: var(--t6); } }
    `;
    const rules = parseCss(css);
    const carriers = rampCarriers([rules]);
    expect([...carriers]).toEqual(['--local']);
    const found = cssFindings('x.css', rules, carriers).map((f) => `${f.kind} ${f.at}: ${f.what.join(', ')}`);
    expect(found).toEqual([
      'definition :root: --action, --local: --t1 --t2, --t3',
      'use .two: --t1, --t2',
      'use .one: --t4',
      'use .heat: --heat-sweep',
      'use .carried: --local',
      'use .stop.hm-s7: an hm-s gradient stop',
      'use .nested: --heat',
      'use @keyframes glow from: --t6',
    ]);
  });

  it('finds every kind of use in a script, by its top-level symbol, and ignores comments', () => {
    const code = `
      // var(--t1) and --heat in a comment, and the word ramp, are not uses
      /** The ramp, in a doc comment. */
      export const STOPS = ['t0', 't1'];
      export function Gradient() { return <stop className="hm-s3" />; }
      export function read(i: number) { return \`var(--t\${i})\`; }
      const SHADER = \`vec3 ramp(float t) { return uStops[0]; }\`;
      export interface Palette { ramp: string[] }
      class Rig { paint(p: Palette) { return p.ramp; } }
      export const style = { background: 'var(--heat)' };
      export function plain() { return 'var(--action) var(--ink)'; }
    `;
    const found = codeFindings('x.tsx', code).map((f) => `${f.at}: ${f.what.join(', ')}`);
    expect(found).toEqual([
      "STOPS: a stop's token name",
      'Gradient: an hm-s gradient stop',
      'read: a stop by a computed name',
      'SHADER: the thermal shader',
      'Palette: `ramp`',
      'Rig.paint: `ramp`',
      'style: a --heat variable',
    ]);
  });
});

describe('the thermal ramp appears only in the eight places of DESIGN_DIRECTION.md 2.4', () => {
  const found = scanSite();
  const uses = found.filter((f) => f.kind === 'use');
  const definitions = found.filter((f) => f.kind === 'definition');

  it('reads every stylesheet and script of the site', () => {
    expect(STYLESHEETS).toEqual(expect.arrayContaining(['app/sheet.css', 'app/tokens.css', 'app/motion-drawing.css', 'app/print.css', 'app/admin/admin.css']));
    expect(SCRIPTS).toEqual(expect.arrayContaining(['lib/og/sheet.tsx', 'components/viewers/model/materials.ts', 'components/home/hero/RavenDrawing.tsx']));
    // Every place but the generated images and the model viewer is drawn by a stylesheet rule.
    expect(new Set(RAMP_USES.map((pin) => pin.place)).size).toBe(8);
  });

  it('finds no use of the ramp outside the list', () => {
    const listed = new Set(RAMP_USES.map((pin) => key(pin.file, pin.at)));
    const unlisted = uses
      .filter((use) => !listed.has(key(use.file, use.at)))
      .map(
        (use) =>
          `${use.file}:${use.line} ${use.at} uses the thermal ramp (${use.what.join(', ')}) outside the eight places of DESIGN_DIRECTION.md 2.4: ` +
          'move it to one of them, or, if it is one, pin it in RAMP_USES with its place',
      );
    expect(unlisted).toEqual([]);
  });

  it('still finds every use on the list', () => {
    const present = new Set(uses.map((use) => key(use.file, use.at)));
    const gone = RAMP_USES.filter((pin) => !present.has(key(pin.file, pin.at))).map(
      (pin) => `${pin.file} ${pin.at} (place ${pin.place}, ${PLACES[pin.place]}) is listed but no longer uses the ramp: remove it from RAMP_USES`,
    );
    expect(gone).toEqual([]);
  });

  it('defines the ramp only in app/tokens.css and on the page frame in app/sheet.css', () => {
    const listed = new Set(RAMP_DEFINITIONS.map((pin) => key(pin.file, pin.at)));
    const elsewhere = definitions
      .filter((d) => !listed.has(key(d.file, d.at)))
      .map((d) => `${d.file}:${d.line} ${d.at} defines the ramp (${d.what.join(', ')}) outside its token definitions (DESIGN_DIRECTION.md 2.3 and 2.4)`);
    expect(elsewhere).toEqual([]);
    const present = new Set(definitions.map((d) => key(d.file, d.at)));
    expect(RAMP_DEFINITIONS.filter((pin) => !present.has(key(pin.file, pin.at)))).toEqual([]);
    // The stops are defined once, with the values of DESIGN_DIRECTION.md 2.3, the same in both themes.
    const stops = definitions.flatMap((d) => d.what.filter((w) => /^--t[0-6]$/.test(w)).map((w) => `${d.file} ${w}`));
    expect(stops.sort()).toEqual(['0', '1', '2', '3', '4', '5', '6'].map((n) => `app/tokens.css --t${n}`));
  });

  it('pins each place where DESIGN_DIRECTION.md 2.4 puts it', () => {
    const byPlace = (place: Place) => RAMP_USES.filter((pin) => pin.place === place).map((pin) => pin.file);
    // Each place lives with the part it belongs to: the hero drawing, the sheet components, the
    // chrome, the generated images and the model viewer.
    expect(byPlace(1).every((file) => /^(app\/motion-drawing\.css|components\/home\/hero\/)/.test(file))).toBe(true);
    expect(byPlace(6).every((file) => file.startsWith('lib/og/'))).toBe(true);
    expect(byPlace(8).every((file) => file.startsWith('components/viewers/model/'))).toBe(true);
    for (const place of [2, 3, 4, 5, 7] as Place[]) expect(byPlace(place).every((file) => file.endsWith('.css')), PLACES[place]).toBe(true);
  });

  it("holds no ramp in the admin's stylesheets or code", () => {
    expect(found.filter((f) => isAdmin(f.file)).map((f) => `${f.file}:${f.line} ${f.at}: ${f.what.join(', ')}`)).toEqual([]);
    // And the admin's stylesheets do not even name a stop or a gradient variable.
    const adminCss = STYLESHEETS.filter(isAdmin);
    expect(adminCss.length).toBeGreaterThan(0);
    for (const file of adminCss) expect(blankComments(read(file)), file).not.toMatch(/--t[0-6](?![\w-])|--heat|hm-s\d/);
  });

  it('adds no ramp to the printed page: app/print.css holds none of its own', () => {
    expect(found.filter((f) => f.file === 'app/print.css')).toEqual([]);
    expect(RAMP_USES.some((pin) => pin.file === 'app/print.css')).toBe(false);
  });
});
