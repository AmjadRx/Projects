/**
 * "Empty sky" (the sky's contract, components/sky/contract.ts; motion sheet 3.5): the sky answers
 * the pointer, a click or tap and a touch drag only where nothing of the page is. The sky itself
 * never takes a pointer event (it lies under the page with pointer-events: none), so the host
 * listens on window and asks this about each event's target and point.
 *
 * Not empty sky: anything inside a control, a text element, a figure, an image, a video, a canvas
 * (other than the sky's own), a table, the nav, a header or footer, a glass panel or a button; and
 * any element with visible text right under the point. One change from the contract's list: an
 * element with a negative tabindex counts as empty sky, because <main tabindex="-1"> (the skip
 * link's target) holds every page and would otherwise leave no sky to answer.
 */

/** The selector for the elements that are never empty sky. */
export const NOT_EMPTY_SKY = [
  'a',
  'button',
  'input',
  'select',
  'textarea',
  'label',
  'summary',
  '[role="button"]',
  '[tabindex]:not([tabindex^="-"])',
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'li',
  'dt',
  'dd',
  'figure',
  'img',
  'video',
  'canvas',
  'table',
  'nav',
  'header',
  'footer',
  '.ar-glass',
  '.ar-btn',
].join(', ');

const TEXT_NODE = 3;

/** True when a text node directly inside `element` has a glyph box under the point (client px). */
function textAt(element: Element, x: number, y: number): boolean {
  let range: Range | null | undefined;
  for (const node of Array.from(element.childNodes)) {
    if (node.nodeType !== TEXT_NODE || !node.textContent?.trim()) continue;
    range ??= element.ownerDocument?.createRange?.();
    if (!range) return false;
    range.selectNodeContents(node);
    for (const box of Array.from(range.getClientRects())) {
      if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) return true;
    }
  }
  return false;
}

/**
 * True when an event at client point (x, y) whose target is `target` lands on empty sky. Anything
 * that is not an element (the document, a window) is not empty sky.
 */
export function isEmptySky(target: EventTarget | null, x: number, y: number): boolean {
  const element = target as Element | null;
  if (!element || typeof element.closest !== 'function') return false;
  const hit = element.closest(NOT_EMPTY_SKY);
  if (hit && !(hit.localName === 'canvas' && hit.closest('.ar-sky'))) return false;
  return !textAt(element, x, y);
}
