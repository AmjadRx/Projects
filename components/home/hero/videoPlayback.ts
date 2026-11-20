/**
 * Whether the hero video may play by itself, and what the visitor's press does to it
 * (components/home/HeroVideo.tsx; ARCHITECTURE.md 6; motion sheets 4.5, 6.1 and 8; D-60), as pure
 * functions, so each rule is tested on its own (tests/hero-video.test.ts; the hero among the
 * page's other players in tests/playback-together.test.ts).
 *
 * Which video plays, and when, is the page's one rule in components/viewers/video/playback.ts: of
 * the videos that may play by themselves, the one most in view plays, muted, and nothing plays by
 * itself while a player the visitor started holds playback. The hero only says whether it takes
 * part. Sheet 4.5: "A video follows the video rules on sheet 6", the same rules as a video block.
 */

/**
 * May the video play by itself? Never under reduced motion (or on /admin), while the visitor has
 * paused motion in the footer, or with Save-Data on (sheet 8.2: nothing autoplays).
 */
export function videoMayAutoplay({ motionOk, paused, saveData }: { motionOk: boolean; paused: boolean; saveData: boolean }): boolean {
  return motionOk && !paused && !saveData;
}

/**
 * Who the hero video answers to (sheet 6.1, as a video block: components/viewers/video/VideoEngine.tsx).
 *
 * - `auto`: it takes part in the autoplay rule and plays, muted, while it is the video most in view
 *   of those at least 0.6 in view.
 * - `visitor`: once the visitor has used its button (or the browser's own controls), it never plays
 *   by itself again on this page. It plays from the visitor's Play, holds playback while it plays,
 *   and stays paused once anything pauses it (the visitor, another player, the lightbox, leaving
 *   the view entirely, a hidden tab) until the visitor presses Play again.
 */
export type HeroVideoMode = 'auto' | 'visitor';

/**
 * Does the hero video take part in the autoplay rule now? Only while it answers to the rule, may
 * play by itself, is on the page (its file loads once it nears the view), and the browser has not
 * refused to start it by itself (Low Power Mode: the poster stays, and the button plays it).
 */
export function heroJoinsAutoplay({
  mode,
  mayAutoplay,
  mounted,
  refused,
}: {
  mode: HeroVideoMode;
  mayAutoplay: boolean;
  mounted: boolean;
  refused: boolean;
}): boolean {
  return mode === 'auto' && mayAutoplay && mounted && !refused;
}

/**
 * What the visitor's press does: pause the video while it plays, whoever started it; otherwise
 * play it, putting it on the page first when it is not there yet (its file loads only near the
 * view while it may play by itself, so under reduced motion or Save-Data the press brings it).
 */
export type HeroPress = 'pause' | 'play' | 'mount-and-play';

export function heroPress({ mounted, playing }: { mounted: boolean; playing: boolean }): HeroPress {
  if (!mounted) return 'mount-and-play';
  return playing ? 'pause' : 'play';
}
