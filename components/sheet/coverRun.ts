/**
 * Phones and tablets (motion sheet 5.2, Phones): a card's video or model cover runs while at least
 * 0.6 of its card is in view, one at a time, the one most in view. Each moving cover joins with an
 * IntersectionObserver and reports its card's share in view; this picks the runner and tells the
 * covers that start and stop. The choice itself is lib/cardMotion.ts pickRunner.
 */
import { pickRunner } from '@/lib/cardMotion';
import { cards } from '@/lib/motion';

interface Member {
  share: number;
  set: (running: boolean) => void;
}

const members = new Map<string, Member>();
let current: string | null = null;

function elect(): void {
  const shares = new Map<string, number>();
  members.forEach((member, id) => shares.set(id, member.share));
  const next = pickRunner(shares, cards.phoneInView, current);
  if (next === current) return;
  const previous = current;
  current = next;
  if (previous) members.get(previous)?.set(false);
  if (next) members.get(next)?.set(true);
}

/**
 * Joins a cover to the phone run. `set` hears when this cover starts (true) and stops (false).
 * Report the card's share in view after each observer entry; leave on unmount.
 */
export function joinCoverRun(id: string, set: (running: boolean) => void): { report: (share: number) => void; leave: () => void } {
  members.set(id, { share: 0, set });
  return {
    report(share: number) {
      const member = members.get(id);
      if (!member) return;
      member.share = share;
      elect();
    },
    leave() {
      if (!members.delete(id)) return;
      if (current === id) {
        current = null;
        set(false);
      }
      elect();
    },
  };
}
