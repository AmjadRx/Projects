/**
 * The phone menu's unroll and roll-up (motion sheet 7.5), as Web Animations on the menu's parts.
 * The sheet comes down from the top like a sheet pulled from a roll: the outer roll moves down from
 * above while the sheet inside counter-moves by as much, so the sheet's content stays where it
 * lands and only its visible part grows, and only transforms run. A 1 px line rides the roll's
 * edge while it opens. The links drop 8 px and fade in, 40 ms apart from 80 ms. Close rolls the
 * sheet back up from wherever it is, the links with it, and Menu pressed during the roll-up brings
 * it back down from wherever that has got to. Every number comes from `page.menu` in
 * lib/motion.ts. Under reduced motion none of this runs: the menu opens and closes at once
 * (components/site/MobileMenu.tsx).
 */
import { cssEasing, page, toMs } from '@/lib/motion';
import { menuLinkDelay } from './chromeMotion';

/** The animated parts of the open menu (components/site/MobileMenu.tsx). */
export interface MenuParts {
  /** .ar-mmenu__roll: the window that moves down from above. */
  roll: HTMLElement;
  /** .ar-mmenu__sheet: the glass sheet inside it, counter-moving. */
  sheet: HTMLElement;
  /** .ar-mmenu__edge: the 1 px line on the roll's edge. */
  edge: HTMLElement;
  /** .ar-mmenu__link: the nav links, in order. */
  links: HTMLElement[];
}

/** The animations of one unroll: the sheet's (roll, sheet, edge) and the links'. */
export interface Unroll {
  frame: Animation[];
  links: Animation[];
}

/** The animations of one roll-up: the sheet's (roll, sheet), and the links' from the unroll it stopped. */
export interface RollUp {
  frame: Animation[];
  links: Animation[];
  /** Settles when the sheet is up: the roll's animation finishing (it rejects if a reopen cancels it). */
  finished: Promise<Animation>;
}

/** Above the window, and the sheet's place inside the roll when the roll is up there. */
const UP = 'translateY(-100%)';
const COUNTER = 'translateY(100%)';

/** An element's transform as drawn now, a running animation included. */
function now(element: HTMLElement): string {
  return element.ownerDocument.defaultView?.getComputedStyle(element).transform || 'none';
}

/**
 * Unrolls the open menu from the top. Call it before the menu's first paint. With `from`, the menu
 * was opened again while it rolled up: the sheet comes back down from where that roll-up has got
 * to, as a roll-up starts from where an unroll has got to, and the links carry on setting from
 * where it stopped them (the ones that had set stay set).
 */
export function unroll(parts: MenuParts, from: RollUp | null = null): Unroll {
  const { open, links } = page.menu;
  const timing: KeyframeAnimationOptions = { duration: toMs(open.duration), easing: cssEasing(open.ease) };
  const rollFrom = from ? now(parts.roll) : UP;
  const sheetFrom = from ? now(parts.sheet) : COUNTER;
  if (from) for (const animation of from.frame) animation.cancel();
  const frame = [
    parts.roll.animate([{ transform: rollFrom }, { transform: 'none' }], timing),
    parts.sheet.animate([{ transform: sheetFrom }, { transform: 'none' }], timing),
    // The line shows only while the sheet unrolls (it is transparent at rest, app/motion-chrome.css).
    parts.edge.animate([{ opacity: 1 }, { opacity: 1 }], timing),
  ];
  if (from) {
    for (const animation of from.links) if (animation.playState === 'paused') animation.play();
    return { frame, links: from.links };
  }
  return {
    frame,
    links: parts.links.map((link, index) =>
      link.animate(
        [
          { opacity: 0, transform: `translateY(${-links.drop}px)` },
          { opacity: 1, transform: 'none' },
        ],
        { duration: toMs(links.duration), delay: menuLinkDelay(index), easing: cssEasing(links.ease), fill: 'backwards' },
      ),
    ),
  };
}

/**
 * Rolls the menu back up from where it is now (an unroll may still be running), the links with
 * it: a link that has not set yet stays unset, one that is setting stops where it is, one that has
 * set stays set. The roll and the sheet hold their last frame until the menu is removed or opened
 * again. The roll-up's `finished` says when the sheet is up.
 */
export function rollUp(parts: MenuParts, running: Unroll | null): RollUp {
  const rollFrom = now(parts.roll);
  const sheetFrom = now(parts.sheet);
  const links = running?.links ?? [];
  for (const animation of links) if (animation.playState === 'running') animation.pause();
  if (running) for (const animation of running.frame) animation.cancel();
  const { close } = page.menu;
  const timing: KeyframeAnimationOptions = {
    duration: toMs(close.duration),
    easing: cssEasing(close.ease),
    fill: 'forwards',
  };
  const sheet = parts.sheet.animate([{ transform: sheetFrom }, { transform: COUNTER }], timing);
  const roll = parts.roll.animate([{ transform: rollFrom }, { transform: UP }], timing);
  return { frame: [roll, sheet], links, finished: roll.finished };
}

/**
 * Ends a roll-up at once with the menu drawn open at rest, every link set: a reopen where motion
 * may no longer play (reduced motion turned on during the roll-up).
 */
export function drawOpen(rolling: RollUp): void {
  for (const animation of [...rolling.frame, ...rolling.links]) animation.cancel();
}
