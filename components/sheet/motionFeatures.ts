import { domAnimation } from 'motion/react';

/**
 * Motion's animation features for the cards' `m` components, in a chunk of their own: LazyMotion
 * loads it after the page is interactive (components/sheet/lazyMotion.ts), so it is not part of
 * any page's first load.
 */
export default domAnimation;
