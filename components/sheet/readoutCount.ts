/**
 * The readouts' count-up in the browser (DESIGN_DIRECTION.md 5.4 and 6.2 step 4; motion sheet 2.3;
 * `load.readouts` in lib/motion.ts; docs/V3_PLAN.md D-59): on first view, with 0.3 of the row
 * visible, each value that is a plain number (./readoutPlan.ts) counts up from 0 with Motion+
 * AnimateNumber, 40 ms apart, over 800 ms (settle). The prefix and the suffix stay put; a value
 * that is not a plain number ("1st", "2nd") is set as it is.
 *
 * What decides, and when:
 * - Once a visit, with the load sequence (lib/intro.ts): a row counts only when the sequence is
 *   playing on the hero as the row comes alive (introPlaying at its mount) and motion may play
 *   (useMotionOk and the pause control). Otherwise every value is set at once: a later home view
 *   in the same visit, reduced motion, a page that comes alive after the sequence has ended. The
 *   server's HTML always carries the final values, so a page without scripts and a search engine
 *   read the true numbers.
 * - While it waits, a counting value shows no digits: its prefix and suffix hold their places and
 *   the digits keep their box, unseen (app/motion-home.css). CSS draws the same start state before
 *   the page is interactive, keyed off the hero's data-intro mark, so a row in the first view never
 *   shows its final values and then drops to zero; when the mark goes, so does that state.
 * - AnimateNumber loads on demand once the row is within `near` window heights of the view, never
 *   in a first load; a row below the fold also waits for the sequence's end (afterIntro), so its
 *   chunk never lands on the sequence's frames. Once it is in, each value shows 0 at its own width
 *   (leading zeros, so its digits never change width and nothing beside them moves) and counts
 *   when the row is in view.
 * - A failed load, motion turned off, or a row in view whose count has not started after
 *   `giveUpAfter` (a slow network) sets the values at once. After the count each value is the plain
 *   text again, exactly as the server sent it.
 *
 * One controller per row, shared by its values (ReadoutValue, a small leaf per value): the row's
 * observers, the import and the timers live here, outside React.
 */
import { afterIntro, introPlaying } from '@/lib/intro';
import { load, toMs } from '@/lib/motion';
import { motionPaused, subscribeMotionPaused } from '@/lib/motionPause';
import { motionOk, subscribeMotionOk } from '@/lib/useMotionOk';
import { countLength, DONE, IDLE, type CountView, type RollComponent } from './readoutPlan';

/** What a row's count needs from the browser; the tests pass their own. */
export interface CountDeps {
  /** True while the load sequence plays on the page's hero. */
  playing: (row: Element) => boolean;
  /** May motion play now (reduced motion, /admin, the pause control)? */
  allowed: () => boolean;
  /** Calls `onChange` whenever that may have changed; returns the function that stops listening. */
  subscribe: (onChange: () => void) => () => void;
  /** Loads AnimateNumber's leaf. */
  load: () => Promise<RollComponent>;
  /**
   * Runs `run` once the load sequence has ended (lib/intro.ts afterIntro), for a row that is not
   * on screen yet; returns the function that cancels the wait. Without it, `run` runs at once.
   */
  later?: (run: () => void) => () => void;
}

const ROW = '.ar-readouts';
const HERO = '.hm-hero';

/** An observer reports the share in view at its threshold as a float: this much below still counts. */
const RATIO_SLACK = 0.001;

const browserDeps: CountDeps = {
  playing: (row) => introPlaying(row.ownerDocument.querySelector(HERO)),
  allowed: () => motionOk() && !motionPaused(),
  subscribe: (onChange) => {
    const stopReduced = subscribeMotionOk(onChange);
    const stopPaused = subscribeMotionPaused(onChange);
    return () => {
      stopReduced();
      stopPaused();
    };
  },
  load: () => import('./ReadoutRoll').then((mod) => mod.default),
  later: (run) => afterIntro(run, document),
};

interface Member {
  index: number;
  show: (view: CountView) => void;
}

interface RowCount {
  join: (member: Member) => () => void;
}

const rows = new WeakMap<Element, RowCount>();

/**
 * Joins the value `el`, at `index` in its row, to its row's count: `show` hears the value's view
 * now and at every change. Returns the function that leaves; when the last value of a row leaves,
 * the row's observers and timers stop. Call it in the browser, from a layout effect, so the
 * decision is drawn before the first paint.
 */
export function joinReadoutCount(el: Element, index: number, show: (view: CountView) => void, deps: CountDeps = browserDeps): () => void {
  const row = el.closest(ROW);
  if (!row) {
    show(DONE);
    return () => {};
  }
  let count = rows.get(row);
  if (!count) {
    count = createRowCount(row, deps, () => rows.delete(row));
    rows.set(row, count);
  }
  return count.join({ index, show });
}

function createRowCount(row: Element, deps: CountDeps, forget: () => void): RowCount {
  const win = row.ownerDocument.defaultView;
  const members = new Set<Member>();
  const stops: Array<() => void> = [];
  let view: CountView = IDLE;
  let decided = false;
  let seen = false;
  let giveUp: number | undefined;
  let end: number | undefined;

  const set = (next: CountView) => {
    view = next;
    for (const member of members) member.show(next);
  };
  const stop = () => {
    for (const fn of stops.splice(0)) fn();
    win?.clearTimeout(giveUp);
    win?.clearTimeout(end);
  };
  const finish = () => {
    if (view.phase === 'done') return;
    stop();
    set(DONE);
  };
  // The row's count starts once AnimateNumber is in and the row is in view; it is over when the
  // last value has settled, and each value is then the plain text again.
  const run = () => {
    if (view.phase !== 'ready' || !seen || !win) return;
    win.clearTimeout(giveUp);
    set({ phase: 'run', Roll: view.Roll });
    const last = Math.max(0, ...Array.from(members, (member) => member.index));
    end = win.setTimeout(finish, toMs(countLength(last)));
  };

  const decide = () => {
    decided = true;
    if (!win || typeof win.IntersectionObserver !== 'function' || !deps.playing(row) || !deps.allowed()) {
      set(DONE);
      return;
    }
    set({ phase: 'wait', Roll: null });
    stops.push(
      deps.subscribe(() => {
        if (!deps.allowed()) finish();
      }),
    );
    const near = new win.IntersectionObserver(
      (entries) => {
        const entry = entries.find((one) => one.isIntersecting);
        if (!entry) return;
        near.disconnect();
        const fetchRoll = () => {
          deps.load().then((Roll) => {
            if (view.phase !== 'wait') return;
            set({ phase: 'ready', Roll });
            run();
          }, finish);
        };
        // A row on screen is part of the load sequence and loads at once. One below the fold cannot
        // count before the visitor scrolls to it, so its chunk waits for the sequence's end.
        const box = entry.boundingClientRect as DOMRectReadOnly | undefined;
        const onScreen = !box || (box.bottom > 0 && box.top < win.innerHeight);
        if (onScreen || !deps.later) fetchRoll();
        else stops.push(deps.later(fetchRoll));
      },
      { rootMargin: `${Math.round(load.readouts.near * 100)}% 0px` },
    );
    const inView = new win.IntersectionObserver(
      (entries) => {
        const enough = entries.some((entry) => entry.isIntersecting && entry.intersectionRatio >= load.readouts.inView - RATIO_SLACK);
        if (!enough) return;
        inView.disconnect();
        seen = true;
        if (view.phase === 'wait') giveUp = win.setTimeout(finish, toMs(load.readouts.giveUpAfter));
        run();
      },
      { threshold: load.readouts.inView },
    );
    near.observe(row);
    inView.observe(row);
    stops.push(
      () => near.disconnect(),
      () => inView.disconnect(),
    );
  };

  return {
    join(member) {
      members.add(member);
      if (decided) member.show(view);
      else decide();
      return () => {
        members.delete(member);
        if (members.size > 0) return;
        stop();
        // A load still on its way finds the row gone and draws nothing.
        view = DONE;
        forget();
      };
    },
  };
}
