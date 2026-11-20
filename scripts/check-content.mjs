/**
 * The content check (ARCHITECTURE.md sections 7 and 12), for `npm run check:content`, the
 * pre-commit hook, and CI. Exits 0 when nothing fails and 1 otherwise.
 *
 * It validates every file in content/ against schema version 3, checks that each repository
 * media path exists in public/ with exact case, runs the public patterns of
 * content-rules.public.json and the private CONTENT_BLOCKLIST terms over every string value and
 * every composed string, checks that every proof resolves to a visible page, and runs the
 * patterns and terms over the Markdown in docs/.
 *
 * CONTENT_BLOCKLIST comes from the environment, or from .env.local on the owner's machine. Its
 * value is never printed: a hit names the file, the field, and the entry number only. When it is
 * missing, the check fails in CI and on Vercel and only warns elsewhere.
 *
 * Usage: node scripts/check-content.mjs [--root <repository directory>]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 18)) {
  console.error(`check:content needs Node 22.18 or newer to load lib/*.ts directly (this is ${process.versions.node}).`);
  process.exit(1);
}

const { ProjectSchema, SiteSchema } = await import('../lib/schema.ts');
const {
  DEFAULT_SITE_URL,
  compileRules,
  lintContent,
  lintMarkdown,
  missingBlocklistIsError,
  parseBlocklist,
  siteHostsOf,
  validateContent,
} = await import('../lib/lint.ts');

const rootArg = process.argv.indexOf('--root');
const ROOT =
  rootArg > -1 ? path.resolve(process.argv[rootArg + 1]) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');

/** CONTENT_BLOCKLIST from the environment, else from .env.local. The value never leaves here. */
function readBlocklist() {
  if (process.env.CONTENT_BLOCKLIST !== undefined) return process.env.CONTENT_BLOCKLIST;
  const envFile = path.join(ROOT, '.env.local');
  if (!fs.existsSync(envFile)) return undefined;
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?CONTENT_BLOCKLIST\s*=\s*(.*?)\s*$/.exec(line);
    if (match) return match[1].replace(/^(['"])(.*)\1$/, '$2');
  }
  return undefined;
}

/**
 * A plain setting (not a secret) from the environment, else from .env.local, trimmed and with
 * pasted quotes removed. Used for GITHUB_REPO and NEXT_PUBLIC_SITE_URL; values are never printed.
 */
function readSetting(name) {
  const clean = (value) => value.trim().replace(/^["']+|["']+$/g, '').trim();
  if (process.env[name] !== undefined) return clean(process.env[name]);
  const envFile = path.join(ROOT, '.env.local');
  if (!fs.existsSync(envFile)) return '';
  for (const rawLine of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const line = rawLine.trim().replace(/^export\s+/, '');
    const eq = line.indexOf('=');
    if (eq > 0 && line.slice(0, eq).trim() === name) return clean(line.slice(eq + 1));
  }
  return '';
}

/** True when the path exists with exactly this case, even on a case-insensitive disk. */
function existsExactCase(base, relativePath) {
  let dir = base;
  for (const segment of relativePath.split('/').filter(Boolean)) {
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch {
      return false;
    }
    if (!names.includes(segment)) return false;
    dir = path.join(dir, segment);
  }
  return true;
}

/** Every repository media path in a JSON value: MediaRef src and poster, and file block src. */
function mediaPaths(value, at = []) {
  if (Array.isArray(value)) return value.flatMap((item, i) => mediaPaths(item, [...at, i]));
  if (value === null || typeof value !== 'object') return [];
  const out = [];
  for (const key of ['src', 'poster', 'captions']) {
    const v = value[key];
    if (typeof v === 'string' && v.startsWith('/media/')) out.push({ path: [...at, key], src: v });
  }
  for (const [key, item] of Object.entries(value)) {
    if (item !== null && typeof item === 'object') out.push(...mediaPaths(item, [...at, key]));
  }
  return out;
}

function formatPath(parts) {
  return parts.reduce((acc, seg) => (typeof seg === 'number' ? `${acc}[${seg}]` : acc ? `${acc}.${seg}` : seg), '');
}

function readJson(file, findings) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    findings.push({ file: rel(file), path: '(file)', rule: 'JSON', message: error.message, severity: 'error' });
    return undefined;
  }
}

function markdownFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) return markdownFiles(p);
    return entry.name.endsWith('.md') ? [p] : [];
  });
}

const findings = [];
const notes = [];

// 1. The rules and the private terms.
const rules = compileRules(JSON.parse(fs.readFileSync(path.join(ROOT, 'content-rules.public.json'), 'utf8')));
const rawBlocklist = readBlocklist();
const blocklist = parseBlocklist(rawBlocklist);
if (rawBlocklist === undefined || blocklist.length === 0) {
  const severity = missingBlocklistIsError(process.env) ? 'error' : 'warning';
  findings.push({
    file: '(environment)',
    path: 'CONTENT_BLOCKLIST',
    rule: 'BLOCKLIST',
    message:
      severity === 'error'
        ? 'CONTENT_BLOCKLIST is not set, so private terms cannot be checked. Set it in Vercel and in the CI secrets.'
        : 'CONTENT_BLOCKLIST is not set here, so private terms were not checked. Add it to .env.local.',
    severity,
  });
} else {
  notes.push(`private terms: ${blocklist.length} checked`);
}

// 2. Read and validate content/.
const contentDir = path.join(ROOT, 'content');
const projectsDir = path.join(contentDir, 'projects');
const raw = {
  site: { file: 'content/site.json', data: readJson(path.join(contentDir, 'site.json'), findings) },
  projects: fs
    .readdirSync(projectsDir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => ({ file: `content/projects/${name}`, data: readJson(path.join(projectsDir, name), findings) })),
};
const { content, findings: schemaFindings } = validateContent(raw, { SiteSchema, ProjectSchema });
findings.push(...schemaFindings);

// 3. Media paths, rules, terms, proofs, and links.
if (content) {
  for (const { file, data } of [raw.site, ...raw.projects]) {
    for (const media of mediaPaths(data)) {
      if (!existsExactCase(path.join(ROOT, 'public'), media.src)) {
        findings.push({
          file,
          path: formatPath(media.path),
          rule: 'MEDIA',
          message: `No file at public${media.src} with exactly this case.`,
          severity: 'error',
        });
      }
    }
  }
  const configuredUrl = readSetting('NEXT_PUBLIC_SITE_URL');
  const siteHosts = siteHostsOf(/^https?:\/\//.test(configuredUrl) ? configuredUrl : DEFAULT_SITE_URL);
  const siteRepository = readSetting('GITHUB_REPO') || undefined;
  if (!siteRepository) notes.push('links to the site repository: not checked (GITHUB_REPO is not set)');
  findings.push(...lintContent(content, { rules, blocklist, siteHosts, siteRepository }));
}

// 4. Documentation.
const docs = markdownFiles(path.join(ROOT, 'docs'));
for (const file of docs) findings.push(...lintMarkdown(rel(file), fs.readFileSync(file, 'utf8'), { rules, blocklist }));

// 5. Interface words (docs/V3_PLAN.md D-56): every string literal and every piece of JSX text in
// the pages, components and libraries, lib/strings.ts among them, and in the first-party scripts
// under public/. The admin and the API routes, rebuilt in Phase 6, are scanned too: the admin's
// JavaScript is a public static file whether or not anyone signs in. Only the linter itself is
// skipped, since it holds the rules' own patterns.
const { checkText } = await import('../lib/lint.ts');
const ts = (await import('typescript')).default;
const INTERFACE_SKIP = [/^lib\/lint\.ts$/];

function sourceFiles(dir, pattern) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' || entry.name.startsWith('.') ? [] : sourceFiles(p, pattern);
    return pattern.test(entry.name) ? [p] : [];
  });
}

function interfaceText(file, text) {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : /\.m?js$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const out = [];
  const add = (node, value) => {
    const trimmed = value.trim();
    if (trimmed) out.push({ line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, text: trimmed });
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      add(node, node.text);
    } else if (ts.isJsxText(node)) {
      add(node, node.text.replace(/\s+/g, ' '));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

const interfaceFiles = [
  ...['app', 'components', 'lib'].flatMap((dir) => sourceFiles(path.join(ROOT, dir), /\.(ts|tsx)$/)),
  ...['public/admin-workers', 'public/viewers'].flatMap((dir) => sourceFiles(path.join(ROOT, dir), /\.m?js$/)),
].filter((file) => !INTERFACE_SKIP.some((re) => re.test(rel(file))));
for (const file of interfaceFiles) {
  for (const { line, text } of interfaceText(file, fs.readFileSync(file, 'utf8'))) {
    for (const hit of checkText(text, rules, blocklist)) {
      findings.push({ file: rel(file), path: `line ${line}`, rule: hit.rule, message: hit.message, severity: 'error' });
    }
  }
}

// 6. No em dash or en dash in any source file, comments included (ARCHITECTURE.md 0, rule 5), the
// README and the CI and test configuration included.
const DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);
const dashFiles = [
  ...['app', 'components', 'lib', 'scripts', 'tests', 'docs', 'public/viewers'].flatMap((dir) =>
    sourceFiles(path.join(ROOT, dir), /\.(ts|tsx|mjs|mts|js|cjs|css|md|json|html)$/),
  ),
  ...['CLAUDE.md', 'README.md', 'package.json', 'next.config.mjs', 'tailwind.config.ts', 'vitest.config.mts', 'vitest.build.config.mts',
    'playwright.config.ts', 'lighthouserc.cjs', '.github/workflows/ci.yml', 'content-rules.public.json']
    .map((name) => path.join(ROOT, name))
    .filter((p) => fs.existsSync(p)),
].filter((file) => rel(file) !== 'content-rules.public.json');
for (const file of dashFiles) {
  fs.readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .forEach((text, index) => {
      if (DASHES.test(text)) {
        findings.push({ file: rel(file), path: `line ${index + 1}`, rule: 'DASH', message: 'An em dash or an en dash. Use a comma, a colon, parentheses, or "to".', severity: 'error' });
      }
    });
}

// Report.
const errors = findings.filter((f) => f.severity === 'error');
const warnings = findings.filter((f) => f.severity === 'warning');
for (const f of [...errors, ...warnings]) {
  console.log(`${f.severity === 'error' ? 'ERROR  ' : 'WARNING'} ${f.file}  ${f.path}  ${f.rule}  ${f.message}`);
}
const fileCount = raw.projects.length + 1 + docs.length;
console.log(
  `check:content: ${fileCount} files (content and docs), ${interfaceFiles.length} interface files, ${dashFiles.length} files scanned for dashes, ${rules.length} public rules` +
    `${notes.length ? `, ${notes.join(', ')}` : ''}: ${errors.length} errors, ${warnings.length} warnings`,
);
process.exit(errors.length > 0 ? 1 : 0);
