/**
 * Motion's features for the cards, loaded on demand (Motion's LazyMotion with `m` components): the
 * first load carries only Motion's small core, and the features arrive in their own chunk once the
 * page is interactive. Pass one of these to `<LazyMotion features={...}>`.
 *
 * On the first home view they also wait for the end of the load sequence (lib/intro.ts), so their
 * chunk is never evaluated on the sequence's frames on a slow phone; nothing on a card moves
 * before the visitor reaches it, and elsewhere the wait ends at once.
 */
import { afterIntro } from '@/lib/intro';

/** Settles once the load sequence has ended, or at once when none plays. */
const introDone = () => new Promise<void>((resolve) => afterIntro(resolve));

/** Animations: the callouts, the highlight's fade, the arrow nudge, a video cover's fade. */
export const animationFeatures = () =>
  introDone()
    .then(() => import('./motionFeatures'))
    .then((mod) => mod.default);

/** Animations and layout: the filter's reflow on /projects. */
export const layoutFeatures = () => import('./motionLayoutFeatures').then((mod) => mod.default);
