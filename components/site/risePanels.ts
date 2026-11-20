/**
 * Panels coming into view (DESIGN_DIRECTION.md 6.3; motion sheet 7.2; docs/V3_PLAN.md D-48): a
 * panel that comes into view after the first paint rises 16 px and fades in, once per page view,
 * when its top passes 0.85 of the window height. Panels that come into view together start 60 ms
 * apart, at most three to a group (a fourth starts with the third). A panel already in the first
 * view is drawn in place, and so is any panel when motion may not play: nothing waits for motion.
 *
 * The server HTML hides nothing. Once the page is interactive, `startPanelRise` marks only the
 * panels that lie wholly below the window (RISE_ATTR, whose start state app/motion-chrome.css
 * draws), so nothing on screen changes, and watches them with one IntersectionObserver. A panel
 * rises through a Web Animation of `opacity` and `translate` from that start state: the individual
 * transform property composes with any `transform` another component sets (the card tilt), nothing
 * moves in the layout, and when the animation ends the panel carries no trace of it.
 *
 * A panel inside another moves only as part of the outer one's rise, as a paragraph does (sheet
 * 7.2, "Inside"). Two cases keep a panel from waiting hidden where it can be seen: a panel that the
 * window cannot show while its row comes into view (a card further along a phone's swipe strip)
 * rises with the group of that row, and a panel near the end of a page, whose top the page cannot
 * scroll up to the line, rises as soon as it shows at the window's foot.
 *
 * Focus never lands on something that cannot be seen (DESIGN_DIRECTION.md 8, focus stays visible).
 * A browser scrolls a link that takes keyboard focus only as far as the window's foot, which can
 * leave its panel's top below the line, so focus entering a waiting panel draws that panel in
 * place at once, with the waiting panels beside and above it, and with no rise, which would start
 * the focus ring from nothing; a panel still rising finishes at once. A panel holding the focus
 * when the page is read never waits. While it waits, unseen, a panel takes no pointer input either
 * (app/motion-chrome.css).
 */
import { cssEasing, page, toMs } from '@/lib/motion';
import { riseDelay } from './chromeMotion';

/**
 * What rises: the glass panels (components/sheet/Glass and the `ar-glass` class) and the project
 * cards, "a glass panel or a card" (sheet 7.2). The nav, the title block and the footer are glass
 * too, but never move (sheet 8.3), and carry neither class.
 */
export const PANEL_SELECTOR = '.ar-glass, .ar-card';

/** The attribute that holds a panel below the first view in its start state (app/motion-chrome.css). */
export const RISE_ATTR = 'data-ar-rise';

interface Waiting {
  panel: HTMLElement;
  top: number;
  left: number;
}

/**
 * Marks the panels inside `main` that lie wholly below the window, and raises each one when its
 * top passes `page.panels.startAt` of the window height. Returns the function that stops watching
 * and draws every panel still waiting or rising in place at once (a route change, or motion turned
 * off). Call it in the browser, with motion allowed, after the page has painted.
 */
export function startPanelRise(main: HTMLElement): () => void {
  const doc = main.ownerDocument;
  const win = doc.defaultView;
  if (!win || typeof win.IntersectionObserver !== 'function') return () => {};
  const { rise, duration, ease, startAt } = page.panels;

  const firstView = win.innerHeight;
  const focused = doc.activeElement;
  const waiting = new Set<HTMLElement>();
  for (const panel of Array.from(main.querySelectorAll<HTMLElement>(PANEL_SELECTOR))) {
    if (panel.parentElement?.closest(PANEL_SELECTOR)) continue;
    const box = panel.getBoundingClientRect();
    // Not drawn at all (display: none), in the first view or above it, or holding the focus: drawn
    // in place.
    if ((box.width === 0 && box.height === 0) || box.top < firstView || (focused && panel.contains(focused))) continue;
    panel.setAttribute(RISE_ATTR, '');
    waiting.add(panel);
  }
  if (waiting.size === 0) return () => {};

  const keyframes: Keyframe[] = [
    { opacity: 0, translate: `0 ${rise}px` },
    { opacity: 1, translate: '0 0' },
  ];
  const timing: KeyframeAnimationOptions = { duration: toMs(duration), easing: cssEasing(ease), fill: 'backwards' };
  /** The line, in px from the window's top. */
  const line = () => win.innerHeight * startAt;
  /** How much further down the page can still scroll, in px. */
  const room = () => (doc.scrollingElement ?? doc.documentElement).scrollHeight - win.innerHeight - win.scrollY;
  /** The rises under way, each until it ends. */
  const rising = new Map<HTMLElement, Animation>();

  /** Stops waiting for a panel: drawn in place from now on, unless a rise starts it from below. */
  const unwatch = (panel: HTMLElement) => {
    waiting.delete(panel);
    atLine.unobserve(panel);
    atEnd.unobserve(panel);
    panel.removeAttribute(RISE_ATTR);
  };

  /**
   * Raises the named panels as one group, with every other waiting panel whose top has passed the
   * line (the ones beside them that a scroller hides from the observers), in reading order.
   */
  const release = (named: Set<Element>) => {
    const limit = line();
    const group: Waiting[] = [];
    for (const panel of waiting) {
      const box = panel.getBoundingClientRect();
      if (named.has(panel) || (box.top < limit && box.bottom > 0)) group.push({ panel, top: box.top, left: box.left });
    }
    group.sort((a, b) => a.top - b.top || a.left - b.left);
    group.forEach(({ panel }, index) => {
      unwatch(panel);
      if (typeof panel.animate !== 'function') return;
      const animation = panel.animate(keyframes, { ...timing, delay: riseDelay(index) });
      rising.set(panel, animation);
      const ended = () => {
        if (rising.get(panel) === animation) rising.delete(panel);
      };
      animation.finished.then(ended, ended);
    });
  };

  const named = (entries: IntersectionObserverEntry[], also: (entry: IntersectionObserverEntry) => boolean) => {
    const found = new Set<Element>();
    for (const entry of entries) {
      if (entry.isIntersecting && waiting.has(entry.target as HTMLElement) && also(entry)) found.add(entry.target);
    }
    return found;
  };

  // The window's foot raised to the line, so a panel "enters" this one when its top passes it.
  const atLine = new win.IntersectionObserver(
    (entries) => {
      const entered = named(entries, () => true);
      if (entered.size > 0) release(entered);
    },
    { rootMargin: `0px 0px -${Math.round((1 - startAt) * 100)}% 0px` },
  );
  // The whole window: a panel that shows at its foot but that the page can no longer scroll up to
  // the line (the last panel of a page) rises as it shows, so no panel ever waits in view.
  const atEnd = new win.IntersectionObserver((entries) => {
    const limit = line();
    const left = room();
    const stranded = named(entries, (entry) => entry.boundingClientRect.top - limit > left + 1);
    if (stranded.size > 0) release(stranded);
  });
  for (const panel of waiting) {
    atLine.observe(panel);
    atEnd.observe(panel);
  }

  // Focus entering a panel: a rising one finishes at once; a waiting one is drawn in place at
  // once, with every waiting panel whose top is level with it or above (its row, and anything
  // before it still below the line).
  const onFocus = (event: FocusEvent) => {
    const target = event.target as Node | null;
    if (!target) return;
    for (const [panel, animation] of rising) if (panel.contains(target)) animation.finish();
    const holder = Array.from(waiting).find((panel) => panel.contains(target));
    if (!holder) return;
    const top = holder.getBoundingClientRect().top;
    for (const panel of Array.from(waiting)) if (panel.getBoundingClientRect().top <= top + 1) unwatch(panel);
  };
  main.addEventListener('focusin', onFocus);

  return () => {
    main.removeEventListener('focusin', onFocus);
    atLine.disconnect();
    atEnd.disconnect();
    for (const panel of waiting) panel.removeAttribute(RISE_ATTR);
    waiting.clear();
    for (const animation of rising.values()) animation.finish();
    rising.clear();
  };
}
