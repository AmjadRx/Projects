/**
 * The words inside files, for the content check at upload (docs/V3_PLAN.md D-24): WebVTT cue text,
 * the text an SVG shows or carries, and the text of Word parts and document properties. Plain
 * string work only, so the tests run it under Node and the browser runs the same code.
 *
 * The rule is to hand the check everything a visitor could see or download, so text that a viewer
 * does not draw (comments, link targets, document properties) is included too.
 */

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  lrm: '',
  rlm: '',
};

/** Decodes character references: the five XML names, a few HTML ones, and numeric ones. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named === undefined ? whole : named;
  });
}

/** One space between words, no blank runs of lines, no space at line ends. */
export function tidyText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t\f\v ]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Joins pieces of text, one per line, leaving out empty ones. */
export function joinText(parts: readonly (string | null | undefined)[]): string {
  return tidyText(parts.filter((part): part is string => typeof part === 'string' && part.trim() !== '').join('\n'));
}

// ---------------------------------------------------------------------------------------------
// WebVTT
// ---------------------------------------------------------------------------------------------

/** True when a text is a WebVTT file: it starts with "WEBVTT", then a space, a tab, or a line end. */
export function isWebVtt(source: string): boolean {
  const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  return /^WEBVTT(?:[ \t\r\n]|$)/.test(text);
}

/**
 * The text of every cue, with speaker names kept ("<v Sam>Hello" gives "Sam: Hello"), and the
 * header's own words. Comment, style, and region blocks are left out: browsers never show them.
 * Returns null when the text is not WebVTT.
 */
export function vttCueText(source: string): string | null {
  if (!isWebVtt(source)) return null;
  const text = (source.charCodeAt(0) === 0xfeff ? source.slice(1) : source).replace(/\r\n?/g, '\n');
  const blocks = text.split(/\n{2,}/);
  const out: string[] = [blocks[0].replace(/^WEBVTT[ \t]*/, '').split('\n')[0]];
  for (const block of blocks.slice(1)) {
    const lines = block.split('\n').filter((line) => line.trim() !== '');
    if (lines.length === 0 || /^(NOTE|STYLE|REGION)(?:[ \t]|$)/.test(lines[0])) continue;
    const timing = lines.findIndex((line) => line.includes('-->'));
    if (timing < 0) continue;
    for (const line of lines.slice(timing + 1)) {
      out.push(
        decodeEntities(
          line
            .replace(/<v(?:\.[^\s>]*)?\s+([^>]*)>/g, '$1: ')
            .replace(/<[^>]*>/g, ''),
        ),
      );
    }
  }
  return joinText(out);
}

// ---------------------------------------------------------------------------------------------
// SVG
// ---------------------------------------------------------------------------------------------

/** Attributes that carry words in drawings (labels, titles, layer names from drawing programs). */
const WORD_ATTRIBUTES = /\s(?:aria-label|title|alt|xlink:title|inkscape:label|sodipodi:docname|data-name)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;

/** The words an SVG holds: its text, titles, descriptions, metadata, comments, and label attributes. */
export function svgText(source: string): string {
  const parts: string[] = [];
  for (const match of source.matchAll(/<!--([\s\S]*?)-->/g)) parts.push(match[1]);
  for (const match of source.matchAll(/<!\[CDATA\[([\s\S]*?)\]\]>/g)) parts.push(match[1]);
  for (const match of source.matchAll(WORD_ATTRIBUTES)) parts.push(decodeEntities(match[1] ?? match[2] ?? ''));
  const body = source
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, ' ')
    .replace(/<\?[\s\S]*?\?>/g, ' ')
    .replace(/<!DOCTYPE[^>[]*(\[[\s\S]*?\])?\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ');
  parts.push(decodeEntities(body));
  return joinText(parts);
}

/** A length attribute in user units or pixels ("2400", "2400px"); null for percentages and other units. */
function svgLength(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^\s*(\d+(?:\.\d+)?)\s*(px)?\s*$/i.exec(value);
  const number = match ? Number(match[1]) : NaN;
  return Number.isFinite(number) && number > 0 ? number : null;
}

/** The intrinsic size of an SVG: its width and height, or its viewBox, rounded to whole pixels. */
export function svgSize(source: string): { width: number; height: number } | null {
  const tag = /<svg\b[^>]*>/i.exec(source)?.[0];
  if (!tag) return null;
  const attribute = (name: string) => new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag);
  const value = (name: string) => {
    const match = attribute(name);
    return match ? (match[1] ?? match[2]) : undefined;
  };
  let width = svgLength(value('width'));
  let height = svgLength(value('height'));
  const box = value('viewBox')?.trim().split(/[\s,]+/).map(Number);
  if (box && box.length === 4 && box.every(Number.isFinite) && box[2] > 0 && box[3] > 0) {
    if (width === null && height === null) {
      width = box[2];
      height = box[3];
    } else if (width === null && height !== null) {
      width = (height * box[2]) / box[3];
    } else if (height === null && width !== null) {
      height = (width * box[3]) / box[2];
    }
  }
  if (width === null || height === null) return null;
  return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
}

// ---------------------------------------------------------------------------------------------
// Word (DOCX): its WordprocessingML parts and the DrawingML, chart, SmartArt, and data parts
// beside them (docs/V3_PLAN.md D-24: the text of Word files, properties included)
// ---------------------------------------------------------------------------------------------

/** A namespace prefix, or none: "w:" in Word parts, "a:" in DrawingML, "c:" in charts, "dgm:" in SmartArt. */
const PREFIX = '(?:[A-Za-z_][\\w.-]*:)?';
/** A whole tag, a ">" inside a quoted attribute value included. */
const TAG = /<(?:[^>"']|"[^"]*"|'[^']*')*>/g;
const COMMENT = /<!--([\s\S]*?)-->/g;
const CDATA = /<!\[CDATA\[([\s\S]*?)\]\]>/g;
const TAB = new RegExp(`<${PREFIX}p?tab\\b[^>]*/>`, 'g');
const BREAK = new RegExp(`<${PREFIX}(?:br|cr)\\b[^>]*>`, 'g');
const HYPHEN = new RegExp(`<${PREFIX}noBreakHyphen\\b[^>]*/>`, 'g');
/** Ends of paragraphs (Word's w:p, DrawingML's a:p), table cells, text boxes, and chart values and points. */
const BLOCK_END = new RegExp(`</${PREFIX}(?:p|tc|txbxContent|pt|v|f)>`, 'g');
/** The attributes of an opening tag that is not self-closing ("/" only where no ">" follows). */
const OPEN_ATTRIBUTES = `(?:[^>"'/]|"[^"]*"|'[^']*'|/(?!>))*`;
/** A tracked deletion (not the empty marker of a deleted paragraph mark), and deleted text outside one. */
const DELETION = new RegExp(`<(${PREFIX}del)\\b${OPEN_ATTRIBUTES}>([\\s\\S]*?)</\\1>`, 'g');
const DELETED_TEXT = new RegExp(`<(${PREFIX}(?:delText|delInstrText))\\b${OPEN_ATTRIBUTES}>([\\s\\S]*?)</\\1>`, 'g');

/** Text inside CDATA, escaped so that removing tags leaves it whole. */
function escapeMarkup(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** The words of XML comments and CDATA sections, which some generators write and readers keep. */
function withoutCommentsAndCdata(xml: string, comments: string[]): string {
  return xml
    .replace(COMMENT, (_whole, comment: string) => {
      comments.push(comment);
      return '';
    })
    .replace(CDATA, (_whole, data: string) => escapeMarkup(data));
}

/** The text of runs, joined as written: a word split across runs stays whole. */
function runText(xml: string): string {
  return xml.replace(TAB, '\t').replace(BREAK, '\n').replace(HYPHEN, '-').replace(BLOCK_END, '\n').replace(TAG, '');
}

/**
 * The text of a WordprocessingML part, or of a DrawingML, chart, or SmartArt part: one line per
 * paragraph, table cell, and chart value, tabs, breaks, and non-breaking hyphens kept, and a word
 * split across runs kept whole. The deleted text of tracked changes, which a reader still sees
 * struck through, is returned apart, each deletion whole, so the text around it reads as it shows.
 */
export function officeXmlText(xml: string): { text: string; deleted: string[] } {
  const comments: string[] = [];
  const deleted: string[] = [];
  const keep = (text: string) => {
    const clean = tidyText(decodeEntities(text));
    if (clean) deleted.push(clean);
  };
  const body = withoutCommentsAndCdata(xml, comments)
    .replace(DELETION, (_whole, _name: string, inner: string) => {
      const pieces: string[] = [];
      for (const match of inner.matchAll(DELETED_TEXT)) pieces.push(match[2]);
      keep(pieces.join(''));
      return '';
    })
    .replace(DELETED_TEXT, (_whole, _name: string, inner: string) => {
      keep(inner);
      return '';
    });
  return {
    text: tidyText(decodeEntities(runText(body)) + (comments.length > 0 ? `\n${comments.join('\n')}` : '')),
    deleted,
  };
}

/** The text of a WordprocessingML part: one line per paragraph, tabs and breaks kept (see officeXmlText). */
export function wordXmlText(xml: string): string {
  return officeXmlText(xml).text;
}

/**
 * Attributes of Office XML whose values are words a reader can see or a downloader can read: the
 * authors and initials of comments and tracked changes, reviewers' account names (people.xml),
 * the alt text, titles, and names of pictures and shapes (a picture's name is often the inserted
 * file's name), tooltips, WordArt text, field codes, list and form-field entries, and links.
 */
const WORD_ATTRIBUTE = new RegExp(
  `\\s${PREFIX}(?:author|initials|userId|descr|title|name|tooltip|string|alt|displayText|value|lastValue|instr|href)\\s*=\\s*(?:"([^"]*)"|'([^']*)')`,
  'gi',
);
/**
 * Elements whose `val` attribute holds words: document variables, content-control titles and
 * tags, form-field defaults, help, and entries, building-block names and descriptions, style
 * names, and the mail-merge source and query.
 */
const WORD_VALUE = new RegExp(
  `<${PREFIX}(?:docVar|alias|tag|default|helpText|statusText|name|description|connectString|query|listEntry|aliases|title|desc)\\b(?:[^>"']|"[^"]*"|'[^']*')*?\\s${PREFIX}val\\s*=\\s*(?:"([^"]*)"|'([^']*)')`,
  'gi',
);

/** The word-carrying attribute values of an Office XML part (see WORD_ATTRIBUTE and WORD_VALUE), each once. */
export function officeAttributeText(xml: string): string[] {
  const out = new Set<string>();
  for (const pattern of [WORD_ATTRIBUTE, WORD_VALUE]) {
    for (const match of xml.matchAll(pattern)) {
      const value = tidyText(decodeEntities(match[1] ?? match[2] ?? ''));
      if (value) out.add(value);
    }
  }
  return [...out];
}

/**
 * The values in a document properties part (docProps/core.xml, app.xml, custom.xml) or another
 * data part (customXml items), one per line: every element's text stands alone, as data does.
 */
export function propertiesXmlText(xml: string): string {
  const comments: string[] = [];
  const values = decodeEntities(withoutCommentsAndCdata(xml, comments).replace(/<\?[\s\S]*?\?>/g, '').replace(TAG, '\n'));
  return tidyText([values, ...comments].join('\n'))
    .split('\n')
    .filter((line) => line !== '')
    .join('\n');
}

/** What a part of a Word file is, which decides how its words are read. */
export type DocxPartRole =
  | 'body' //          word/document.xml
  | 'word' //          other WordprocessingML, DrawingML, chart, and SmartArt parts under word/
  | 'relationships' // .rels parts: their external link addresses
  | 'properties' //    docProps/*.xml
  | 'drawing' //       an SVG picture: its words, as for an SVG upload
  | 'data' //          other XML (customXml items) and any other part, read as text when it is text
  | 'picture' //       raster and vector pictures: never read for words, as photos are not
  | 'font' //          embedded fonts
  | 'embedded'; //     embedded files and objects (word/embeddings/): never read, so the owner is asked

const PICTURE_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'jpe', 'jfif', 'gif', 'bmp', 'dib', 'tif', 'tiff', 'emf', 'wmf', 'emz', 'wmz',
  'wdp', 'jxr', 'hdp', 'webp', 'ico', 'pict', 'pct', 'heic', 'heif', 'avif',
]);
const FONT_EXTENSIONS = new Set(['odttf', 'ttf', 'otf', 'fntdata', 'eot', 'woff', 'woff2']);

export function docxPartRole(name: string): DocxPartRole {
  const path = name.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
  const segment = path.slice(path.lastIndexOf('/') + 1);
  const ext = segment.includes('.') ? segment.slice(segment.lastIndexOf('.') + 1) : '';
  if (/(?:^|\/)embeddings\//.test(path)) return 'embedded';
  if (PICTURE_EXTENSIONS.has(ext)) return 'picture';
  if (FONT_EXTENSIONS.has(ext) || path.startsWith('word/fonts/')) return 'font';
  if (ext === 'rels') return 'relationships';
  if (path === 'word/document.xml') return 'body';
  if (ext === 'svg') return 'drawing';
  if (path.startsWith('word/') && (ext === 'xml' || ext === 'vml')) return 'word';
  if (path.startsWith('docprops/') && ext === 'xml') return 'properties';
  return 'data';
}

/** One part of a Word file: its name, what it is, and its text, or null when it is not text or could not be read. */
export interface DocxPart {
  name: string;
  role: DocxPartRole;
  text: string | null;
}

/**
 * The words of a Word file for the content check, from its parts: the body, the other Word parts
 * (headers, footers, notes, comments, glossary, charts, SmartArt), deleted text, data parts, the
 * word-carrying attributes, external links, the document properties, and the part names. `unread`
 * lists the parts whose words could not be read (embedded files, data that is not text, parts
 * that failed to unpack); pictures and fonts are not read and not listed.
 */
export function docxWords(parts: readonly DocxPart[]): { body: string; text: string; unread: string[] } {
  const body: string[] = [];
  const word: string[] = [];
  const deleted: string[] = [];
  const data: string[] = [];
  const attributes = new Set<string>();
  const links = new Set<string>();
  const properties: string[] = [];
  const unread: string[] = [];
  for (const part of parts) {
    if (part.role === 'picture' || part.role === 'font') continue;
    if (part.role === 'embedded' || part.text === null) {
      unread.push(part.name);
      continue;
    }
    const source = part.text;
    const isXml = /^\s*</.test(source);
    switch (part.role) {
      case 'body':
      case 'word': {
        const words = officeXmlText(source);
        (part.role === 'body' ? body : word).push(words.text);
        deleted.push(...words.deleted);
        break;
      }
      case 'relationships':
        for (const target of externalTargets(source)) links.add(target);
        continue;
      case 'drawing':
        word.push(svgText(source));
        continue;
      case 'properties':
        properties.push(propertiesXmlText(source));
        break;
      case 'data':
        data.push(isXml ? propertiesXmlText(source) : tidyText(source));
        break;
    }
    if (isXml) for (const value of officeAttributeText(source)) attributes.add(value);
  }
  return {
    body: joinText(body),
    text: joinText([...body, ...word, ...deleted, ...data, ...attributes, ...links, ...properties, ...parts.map((part) => part.name)]),
    unread,
  };
}

/** The addresses of external links in a relationships part (word/_rels/document.xml.rels). */
export function externalTargets(xml: string): string[] {
  const out: string[] = [];
  for (const match of xml.matchAll(/<Relationship\b[^>]*>/g)) {
    const tag = match[0];
    if (!/\bTargetMode\s*=\s*["']External["']/i.test(tag)) continue;
    const target = /\bTarget\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(tag);
    const value = target ? decodeEntities(target[1] ?? target[2] ?? '').trim() : '';
    if (value) out.push(value);
  }
  return out;
}
