/**
 * Measuring sideways overflow (ARCHITECTURE.md 15, item 4: "The site works at 390, 768, 1024, and
 * 1440 px with no horizontal scroll"). Three signs: the document wider than the window; the window
 * moving sideways when asked to; and content cut off at the window's edge.
 *
 * The page frame (.ar-frame, app/styles/frame.css) clips its content sideways, so content too wide
 * for the window inside it never widens the document: it is cut off at the window's edge instead,
 * and the first two signs only ever see what lies outside the frame (the menu's layer on <body>, for
 * one). The third sign is the one that sees inside it. For each piece of content (an element with
 * text of its own, a control, or a picture, video, frame, canvas or drawing that is not hidden from
 * assistive technology), it takes the part that can show: the element's box cut by every box on the
 * way up that clips it sideways. A strip that scrolls or clips inside the window holds what runs
 * past its own edge, which is its business (a carousel's next card); a box that itself reaches past
 * the window cuts nothing off there, so what shows of its content past the window's edge is cut off
 * by the frame. A fixed element is cut by the window itself; it is measured the same way.
 */
import type { Page } from '@playwright/test';

export interface Overflow {
  clientWidth: number;
  scrollWidth: number;
  /** How far the window moved when asked to scroll right. */
  scrolledBy: number;
  /** Content whose shown part reaches past the window's edge, described, at most 8. */
  cut: string[];
}

export function overflow(page: Page): Promise<Overflow> {
  return page.evaluate(() => {
    const root = document.documentElement;
    const clientWidth = root.clientWidth;
    const top = window.scrollY;
    window.scrollTo({ left: 100_000, top, behavior: 'instant' });
    const scrolledBy = window.scrollX;
    window.scrollTo({ left: 0, top, behavior: 'instant' });

    const frame = document.querySelector('.ar-frame');
    const CONTROL = 'a[href], button, input, select, textarea, [tabindex]';
    const MEDIA = 'img, picture, video, iframe, canvas, svg, object, embed';
    /** The box clips its content sideways: any overflow but visible, or paint containment. */
    const clips = (style: CSSStyleDeclaration) => style.overflowX !== 'visible' || /\b(paint|strict|content)\b/.test(style.contain);
    /**
     * The part of the element's box, left to right, that can show: cut by every box between it and
     * the page frame that clips sideways, up to and including a fixed box (the frame does not clip
     * what is fixed; the window does). Null when nothing of it can show.
     */
    const shown = (element: Element, box: DOMRect): { left: number; right: number } | null => {
      let left = box.left;
      let right = box.right;
      if (getComputedStyle(element).position === 'fixed') return { left, right };
      for (let parent = element.parentElement; parent && parent !== frame && parent !== document.body; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        // A box with display: contents has no box of its own to clip with.
        if (style.display !== 'contents' && clips(style)) {
          const outer = parent.getBoundingClientRect();
          left = Math.max(left, outer.left);
          right = Math.min(right, outer.right);
          if (right <= left) return null;
        }
        if (style.position === 'fixed') break;
      }
      return { left, right };
    };
    const describe = (element: Element, part: { left: number; right: number }) => {
      const classes = typeof element.className === 'string' ? element.className.split(/\s+/).filter(Boolean).slice(0, 2) : [];
      const name = element.getAttribute('aria-label') || element.getAttribute('alt') || element.textContent || '';
      const text = name.replace(/\s+/g, ' ').trim().slice(0, 30);
      return `${element.tagName.toLowerCase()}${classes.map((c) => `.${c}`).join('')}${text ? ` "${text}"` : ''} (shows from ${Math.round(part.left)} to ${Math.round(part.right)} px)`;
    };
    const past = (part: { left: number; right: number }) => part.right > clientWidth + 1 || part.left < -1;

    const cut: string[] = [];
    for (const element of Array.from(document.body.querySelectorAll('*'))) {
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.height === 0 || !past(box)) continue;
      if (getComputedStyle(element).visibility === 'hidden') continue;
      const ownText = Array.from(element.childNodes).some((node) => node.nodeType === Node.TEXT_NODE && (node.nodeValue ?? '').trim() !== '');
      const control = element.matches(CONTROL);
      const media = element.matches(MEDIA) && !element.closest('[aria-hidden="true"]');
      if (!ownText && !control && !media) continue;
      const part = shown(element, box);
      if (!part || !past(part)) continue;
      cut.push(describe(element, part));
      if (cut.length >= 8) break;
    }
    return { clientWidth, scrollWidth: root.scrollWidth, scrolledBy, cut };
  });
}
