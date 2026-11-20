/**
 * The hero video's own rules (components/home/hero/videoPlayback.ts): whether it may play by
 * itself, when it takes part in the page's autoplay rule, and what the visitor's press does. Which
 * video plays is the page's one rule (components/viewers/video/playback.ts); the hero among the
 * page's other players is in tests/playback-together.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { heroJoinsAutoplay, heroPress, videoMayAutoplay, type HeroVideoMode } from '../components/home/hero/videoPlayback';

const MODES: HeroVideoMode[] = ['auto', 'visitor'];
const BOTH = [false, true];

describe('videoMayAutoplay: the hero video never plays by itself under reduced motion, with motion paused, or with Save-Data', () => {
  it.each([
    [{ motionOk: true, paused: false, saveData: false }, true],
    [{ motionOk: false, paused: false, saveData: false }, false],
    [{ motionOk: true, paused: true, saveData: false }, false],
    [{ motionOk: true, paused: false, saveData: true }, false],
    [{ motionOk: false, paused: true, saveData: true }, false],
  ])('%o: %s', (input, expected) => {
    expect(videoMayAutoplay(input)).toBe(expected);
  });
});

describe('heroJoinsAutoplay: when the hero takes part in the autoplay rule', () => {
  const every = MODES.flatMap((mode) =>
    BOTH.flatMap((mayAutoplay) => BOTH.flatMap((mounted) => BOTH.map((refused) => ({ mode, mayAutoplay, mounted, refused })))),
  );

  it('takes part while it answers to the rule, may play by itself, is on the page, and was not refused', () => {
    expect(heroJoinsAutoplay({ mode: 'auto', mayAutoplay: true, mounted: true, refused: false })).toBe(true);
  });

  it('never once the visitor has taken it over, in any situation', () => {
    for (const s of every.filter((x) => x.mode === 'visitor')) expect(heroJoinsAutoplay(s), JSON.stringify(s)).toBe(false);
  });

  it('never when it may not play by itself (reduced motion, paused motion, Save-Data), in any situation', () => {
    for (const s of every.filter((x) => !x.mayAutoplay)) expect(heroJoinsAutoplay(s), JSON.stringify(s)).toBe(false);
  });

  it('not before its video is on the page, and not after the browser refused to start it by itself', () => {
    expect(heroJoinsAutoplay({ mode: 'auto', mayAutoplay: true, mounted: false, refused: false })).toBe(false);
    expect(heroJoinsAutoplay({ mode: 'auto', mayAutoplay: true, mounted: true, refused: true })).toBe(false);
  });
});

describe("heroPress: the visitor's press", () => {
  it('pauses the video while it plays, whoever started it', () => {
    expect(heroPress({ mounted: true, playing: true })).toBe('pause');
  });

  it('plays it otherwise, and brings it onto the page first when it is not there yet (reduced motion, Save-Data)', () => {
    expect(heroPress({ mounted: true, playing: false })).toBe('play');
    expect(heroPress({ mounted: false, playing: false })).toBe('mount-and-play');
  });
});
