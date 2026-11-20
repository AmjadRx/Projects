/**
 * Measuring sideways overflow (ARCHITECTURE.md 15, item 4: "The site works at 390, 768, 1024, and
 * 1440 px with no horizontal scroll"). Three signs: the document wider than the window; the window
 * moving sideways when asked to; and text or a control reaching past the window's edge where only
 * the page frame clips it. The frame (.hm, app/styles/frame.css) clips its content sideways, so
 * content too wide for the window is cut off there instead of scrolling the page; content that a
 * box of its own clips or scrolls (a strip, a carousel, a table) is that box's business and is left
 * out.
 */
import type { Page } from '@playwright/test';

export interface Overflow {
  clientWidth: number;
  scrollWidth: number;
  /** How far the window moved when asked to scroll right. */
  scrolledBy: number;
  /** Text and controls past the window's edge that nothing but the page frame clips. */
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
    /** A box between the element and the page frame clips or scrolls it sideways, or it is fixed. */
    const heldBelowFrame = (element: Element) => {
      for (let parent = element.parentElement; parent && parent !== frame && parent !== document.body; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (style.overflowX !== 'visible' || style.position === 'fixed') return true;
      }
      return false;
    };
    const describe = (element: Element, box: DOMRect) => {
      const classes = typeof element.className === 'string' ? element.className.split(/\s+/).filter(Boolean).slice(0, 2) : [];
      const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 30);
      return `${element.tagName.toLowerCase()}${classes.map((c) => `.${c}`).join('')}${text ? ` "${text}"` : ''} (from ${Math.round(box.left)} to ${Math.round(box.right)} px)`;
    };
    const cut: string[] = [];
    for (const element of Array.from(document.body.querySelectorAll('*'))) {
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.height === 0 || (box.right <= clientWidth + 1 && box.left >= -1)) continue;
      const style = getComputedStyle(element);
      if (style.position === 'fixed' || style.visibility === 'hidden') continue;
      const ownText = Array.from(element.childNodes).some((node) => node.nodeType === Node.TEXT_NODE && (node.nodeValue ?? '').trim() !== '');
      const control = element.matches('a[href], button, input, select, textarea, [tabindex]');
      if ((!ownText && !control) || heldBelowFrame(element)) continue;
      cut.push(describe(element, box));
      if (cut.length >= 8) break;
    }
    return { clientWidth, scrollWidth: root.scrollWidth, scrolledBy, cut };
  });
}
