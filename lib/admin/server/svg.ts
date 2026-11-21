/**
 * SVG sanitizing for uploads (ARCHITECTURE.md 11 "Uploads", 13A; docs/V3_PLAN.md D-24, R-13).
 * Server only.
 *
 * The site's policy allows inline scripts, so an SVG file served from its origin must not be able
 * to run anything or load anything. DOMPurify, on a jsdom window, keeps the SVG profile and drops
 * scripts, event handlers, foreignObject, animation (which can rewrite attributes), and
 * `javascript:` addresses. A second pass here then allows only references inside the drawing:
 * `href` and `xlink:href` must start with "#" (an `<image>` may also carry an embedded PNG, JPEG,
 * WebP, or GIF as base64), and every other attribute value and every `<style>` must pass the same
 * CSS test (`cssIsSafe`): `url(...)` only to "#", and no `@import`, CSS escape, `image-set()`,
 * `image()`, `src()`, or other way to load a file, since a browser reads presentation attributes
 * such as `fill` and `mask` as CSS. A `<style>` that holds an element is removed: the browser
 * builds the style sheet from the style's own text only, so an element inside could split a word
 * and hide it from the check. A last pass checks every rule again and refuses the file if anything
 * slipped through. An ordinary drawing (paths, groups, text, gradients, defs, symbols,
 * `<use href="#id">`) comes out unchanged in meaning.
 *
 * What is removed goes with everything inside it: editors' metadata (an author's name in
 * `<metadata>`, a whole private copy of the document in Illustrator's data block) never survives
 * as loose text. Links are the one exception: an `<a>` is unwrapped and the shapes inside it stay.
 * An embedded image loses its metadata too (D-24), and one that is not the image it claims to be is
 * dropped.
 *
 * jsdom and DOMPurify are loaded on first use, once per process, and never reach a browser.
 */
import 'server-only';
import type { DOMPurify } from 'dompurify';
import { ApiFailure } from './guard';
import { cleanEmbeddedImage, markupKind, type EmbeddedImageType } from './sniff';

const SVG_NS = 'http://www.w3.org/2000/svg';
const NOT_SVG = 'This file is not an SVG drawing, so it cannot be stored as one.';
const EMPTY_SVG = 'Nothing is left of this SVG drawing once scripts and outside references are removed.';
const UNSAFE_SVG = 'This SVG drawing could not be made safe to show on the site.';

/** Elements that run code, embed another document, hold metadata, or change the drawing over time. */
const FORBIDDEN_ELEMENTS = [
  'script',
  'foreignObject',
  'animate',
  'animateMotion',
  'animateTransform',
  'animateColor',
  'set',
  'discard',
  'handler',
  'listener',
  'iframe',
  'embed',
  'object',
  'audio',
  'video',
  'canvas',
  'metadata',
];
/** Never in a stored drawing: the forbidden elements, and links, which `clean` unwraps. */
const FORBIDDEN_NAMES: ReadonlySet<string> = new Set([...FORBIDDEN_ELEMENTS, 'a'].map((name) => name.toLowerCase()));

/** An image embedded in the drawing itself: the only address allowed besides "#id". */
const EMBEDDED_IMAGE = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/=\s]*)$/i;
const URL_FUNCTION = /url\(\s*(['"]?)([^'")]*)\1\s*\)/gi;
/** CSS that can load a file or run code, beyond url(): imports, fonts, escapes that hide a name, image-set(), image(), src(). */
const UNSAFE_CSS =
  /@import|@font-face|@namespace|\\|image-set\s*\(|(?<![\w-])image\s*\(|(?<![\w-])src\s*\(|expression\s*\(|-moz-binding|behavior\s*:|javascript:/i;

/** True when every url() in a value points inside the drawing. */
function urlsAreLocal(value: string): boolean {
  for (const match of value.matchAll(URL_FUNCTION)) {
    if (!match[2].trim().startsWith('#')) return false;
  }
  // An unmatched "url(" (an odd quote, a missing parenthesis) is not trusted either.
  const opened = (value.match(/url\s*\(/gi) ?? []).length;
  const matched = [...value.matchAll(URL_FUNCTION)].length;
  return opened === matched;
}

function cssIsSafe(css: string): boolean {
  return !UNSAFE_CSS.test(css) && urlsAreLocal(css);
}

function hrefIsSafe(element: Element, value: string): boolean {
  const target = value.trim();
  if (target.startsWith('#')) return true;
  return element.localName === 'image' && EMBEDDED_IMAGE.test(target);
}

/** Why an attribute must go, or null when it may stay. */
function attributeProblem(element: Element, attr: Attr): string | null {
  const name = attr.name.toLowerCase();
  if (name.startsWith('on')) return 'event handler';
  if (name === 'href' || name === 'xlink:href' || attr.localName === 'href') {
    return hrefIsSafe(element, attr.value) ? null : 'outside reference';
  }
  if (name === 'xml:base' || name === 'src' || name === 'srcset' || name === 'action' || name === 'formaction') return 'address';
  if (name === 'style') return cssIsSafe(attr.value) ? null : 'style';
  // Presentation attributes (fill, stroke, mask, filter, clip-path, cursor...) are parsed as CSS,
  // escapes and image-set() included, so every other value passes the style test too.
  if (!cssIsSafe(attr.value)) return 'css';
  if (/javascript:/i.test(attr.value.replace(/[\s\u0000-\u001f]/g, ''))) return 'script address';
  return null;
}

/**
 * True when a `<style>` holds an element. The browser builds the style sheet from the style's own
 * text only, while `textContent` also reads the text inside such an element, so "@imp<g>Z</g>ort"
 * would pass the check as "@impZort" and load a file as "@import".
 */
function styleHoldsElement(element: Element): boolean {
  return element.localName.toLowerCase() === 'style' && element.children.length > 0;
}

/** True when a `<style>` is safe: only text inside, and that text passes the CSS test. */
function styleIsSafe(element: Element): boolean {
  return !styleHoldsElement(element) && cssIsSafe(element.textContent ?? '');
}

/** Every element under and including `root`, breadth first. */
function elementsOf(root: Element): Element[] {
  const out: Element[] = [root];
  // One push per child: a drawing with tens of thousands of paths in one group would overflow a spread.
  for (let i = 0; i < out.length; i += 1) {
    for (const child of Array.from(out[i].children)) out.push(child);
  }
  return out;
}

/** Removes what DOMPurify's profile allows but this site does not. */
function clean(root: Element): void {
  for (const element of elementsOf(root)) {
    // Skip what an earlier step removed with its parent (the fragment is never connected to a document).
    if (element !== root && !root.contains(element)) continue;
    const name = element.localName.toLowerCase();
    if (element !== root && name === 'a') {
      // A link is unwrapped: its shapes stay where they were, and they are cleaned in turn.
      element.replaceWith(...Array.from(element.childNodes));
      continue;
    }
    if (element !== root && (FORBIDDEN_NAMES.has(name) || (name === 'style' && !styleIsSafe(element)))) {
      element.remove();
      continue;
    }
    for (const attr of Array.from(element.attributes)) {
      if (attributeProblem(element, attr)) element.removeAttributeNode(attr);
    }
  }
}

/**
 * Every embedded image without its metadata (D-24). An address whose bytes are not the image it
 * names, or cannot be read, is removed like any other unsafe address.
 */
async function cleanImages(root: Element): Promise<void> {
  for (const element of elementsOf(root)) {
    if (element.localName !== 'image') continue;
    for (const attr of Array.from(element.attributes)) {
      if (attr.localName !== 'href') continue;
      const match = EMBEDDED_IMAGE.exec(attr.value.trim());
      if (!match) continue;
      const type = match[1].toLowerCase() as EmbeddedImageType;
      const cleaned = await cleanEmbeddedImage(type, new Uint8Array(Buffer.from(match[2].replace(/\s+/g, ''), 'base64')));
      if (cleaned) attr.value = `data:image/${type};base64,${Buffer.from(cleaned).toString('base64')}`;
      else element.removeAttributeNode(attr);
    }
  }
}

/** True when nothing unsafe is left. */
function verify(root: Element): boolean {
  for (const element of elementsOf(root)) {
    const name = element.localName.toLowerCase();
    if (FORBIDDEN_NAMES.has(name)) return false;
    if (element.namespaceURI !== SVG_NS) return false;
    if (name === 'style' && !styleIsSafe(element)) return false;
    for (const attr of Array.from(element.attributes)) {
      if (attributeProblem(element, attr)) return false;
    }
  }
  return true;
}

interface Sanitizer {
  purify: DOMPurify;
  serialize(node: Node): string;
  parseXml(text: string): Document;
}

let sanitizer: Promise<Sanitizer> | null = null;

/** jsdom and DOMPurify, made once per process on first use. */
function getSanitizer(): Promise<Sanitizer> {
  sanitizer ??= (async () => {
    const [{ JSDOM }, { default: createDOMPurify }] = await Promise.all([import('jsdom'), import('dompurify')]);
    const { window } = new JSDOM('<!doctype html><title>svg</title>');
    const purify = createDOMPurify(window as unknown as Parameters<typeof createDOMPurify>[0]);
    // Drop an outside reference as DOMPurify reads it, so its own URI checks never keep one.
    purify.addHook('uponSanitizeAttribute', (node, data) => {
      const name = data.attrName.toLowerCase();
      if ((name === 'href' || name === 'xlink:href') && !hrefIsSafe(node, data.attrValue)) data.keepAttr = false;
      if (name.startsWith('on')) data.keepAttr = false;
    });
    const serializer = new window.XMLSerializer();
    const parser = new window.DOMParser();
    return {
      purify,
      serialize: (node: Node) => serializer.serializeToString(node),
      parseXml: (text: string) => parser.parseFromString(text, 'image/svg+xml'),
    };
  })();
  sanitizer.catch(() => {
    sanitizer = null;
  });
  return sanitizer;
}

export interface SanitizedSvg {
  /** The drawing to store: one `<svg>` element, serialized as XML (UTF-8). */
  bytes: Uint8Array;
  /** The drawing's words (text, titles, descriptions), for the content check. */
  text: string;
}

/** The words a reader of the drawing sees, without the styles. */
function wordsOf(root: Element): string {
  const words: string[] = [];
  for (const element of elementsOf(root)) {
    if (element.localName === 'style') continue;
    for (const node of Array.from(element.childNodes)) {
      if (node.nodeType === 3 || node.nodeType === 4) words.push(node.nodeValue ?? '');
    }
  }
  return words.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * The sanitized drawing, or ApiFailure 422 'invalid-file' when the file is not an SVG drawing,
 * when nothing drawable is left, or when the result still breaks a rule.
 */
export async function sanitizeSvg(input: Uint8Array | string): Promise<SanitizedSvg> {
  let text: string;
  if (typeof input === 'string') {
    text = input.replace(/^\uFEFF/, '');
  } else {
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(input);
    } catch {
      throw new ApiFailure(422, 'invalid-file', NOT_SVG);
    }
  }
  if (markupKind(text) !== 'svg') throw new ApiFailure(422, 'invalid-file', NOT_SVG);

  const { purify, serialize, parseXml } = await getSanitizer();
  const fragment = purify.sanitize(text, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_TAGS: ['use'],
    FORBID_TAGS: FORBIDDEN_ELEMENTS,
    ALLOW_DATA_ATTR: false,
    // A removed element takes its content with it (text included), so nothing it held is hoisted.
    KEEP_CONTENT: false,
    RETURN_DOM_FRAGMENT: true,
  });
  const elements = Array.from(fragment.children);
  const root = elements[0];
  if (elements.length !== 1 || !root || root.localName !== 'svg' || root.namespaceURI !== SVG_NS) {
    throw new ApiFailure(422, 'invalid-file', NOT_SVG);
  }
  clean(root);
  await cleanImages(root);
  if (root.children.length === 0) throw new ApiFailure(422, 'invalid-file', EMPTY_SVG);
  if (!verify(root)) throw new ApiFailure(422, 'invalid-file', UNSAFE_SVG);

  const xml = serialize(root);
  const reparsed = parseXml(xml);
  if (reparsed.getElementsByTagName('parsererror').length > 0 || reparsed.documentElement?.localName !== 'svg') {
    throw new ApiFailure(422, 'invalid-file', UNSAFE_SVG);
  }
  if (!verify(reparsed.documentElement)) throw new ApiFailure(422, 'invalid-file', UNSAFE_SVG);
  return { bytes: new TextEncoder().encode(xml), text: wordsOf(root) };
}
