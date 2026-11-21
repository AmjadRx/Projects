// @vitest-environment jsdom
/**
 * Who plays (components/viewers/video/playback.ts; motion sheet 6.1): one player at a time, the
 * one video most in view that plays by itself, the visitor's hold, and the lightbox's layer. The
 * module keeps page-wide state, so each test loads a fresh copy.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { media } from '../lib/motion';

type Playback = typeof import('../components/viewers/video/playback');

let pb: Playback;

beforeEach(async () => {
  vi.resetModules();
  pb = await import('../components/viewers/video/playback');
});

const { inView, shareStep } = media.video;

/** A stand-in video: records what the rule asked of it. */
function video(id: string, layer = 0) {
  const log: string[] = [];
  const pause = vi.fn(() => log.push('pause'));
  const unregister = pb.registerPlayer(id, pause, layer);
  const handle = pb.joinAutoplay(id, {
    layer,
    play: () => log.push('play'),
    stop: () => log.push('stop'),
  });
  return { id, log, pause, handle, unregister };
}

describe('pickAutoplay: the one most in view of those at least 0.6 in view', () => {
  const pick = (entries: { id: string; share: number; layer?: number }[], current: string | null = null, minLayer = 0) =>
    pb.pickAutoplay(
      entries.map((e) => ({ layer: 0, ...e })),
      current,
      minLayer,
      inView,
      shareStep,
    );

  it('takes nothing under the threshold, and the threshold itself exactly', () => {
    expect(pick([{ id: 'a', share: 0.59 }])).toBeNull();
    expect(pick([{ id: 'a', share: 0.5988 }])).toBeNull();
    expect(pick([{ id: 'a', share: 0.6 }])).toBe('a');
    expect(pick([])).toBeNull();
  });

  it('takes the one most in view', () => {
    expect(pick([{ id: 'a', share: 0.7 }, { id: 'b', share: 1 }])).toBe('b');
    expect(pick([{ id: 'a', share: 1 }, { id: 'b', share: 0.8 }])).toBe('a');
  });

  it('keeps the one playing between equals, else the first', () => {
    expect(pick([{ id: 'a', share: 1 }, { id: 'b', share: 1 }])).toBe('a');
    expect(pick([{ id: 'a', share: 1 }, { id: 'b', share: 1 }], 'b')).toBe('b');
    // Shares compare in tenths: 0.97 and 1 are equal, so the playing one stays.
    expect(pick([{ id: 'a', share: 1 }, { id: 'b', share: 0.97 }], 'b')).toBe('b');
    expect(pick([{ id: 'a', share: 1 }, { id: 'b', share: 0.9 }], 'b')).toBe('a');
  });

  it('prefers the top layer and leaves out layers under the open one', () => {
    expect(pick([{ id: 'page', share: 1 }, { id: 'box', share: 0.7, layer: 1 }])).toBe('box');
    expect(pick([{ id: 'page', share: 1 }], null, 1)).toBeNull();
  });
});

describe('viewShare and shareThresholds', () => {
  it('is the intersection ratio for a video that fits the view', () => {
    expect(pb.viewShare(0.6, 400, 900)).toBeCloseTo(0.6);
    expect(pb.viewShare(1, 400, 900)).toBe(1);
    expect(pb.viewShare(0, 400, 900)).toBe(0);
    expect(pb.viewShare(Number.NaN, 400, 900)).toBe(0);
  });

  it('counts a video taller than the view as wholly in view when it fills the view', () => {
    // 1,800 px tall in a 900 px view: at most half of it can show.
    expect(pb.viewShare(0.5, 1800, 900)).toBe(1);
    expect(pb.viewShare(0.3, 1800, 900)).toBeCloseTo(0.6);
    expect(pb.viewShare(0.25, 1800, 900)).toBeCloseTo(0.5);
  });

  it('observes in tenths, with the threshold among them', () => {
    const list = pb.shareThresholds(shareStep, inView);
    expect(list).toEqual([0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]);
    expect(list).toContain(inView);
    expect(pb.shareThresholds(0.25, 0.6)).toEqual([0, 0.25, 0.5, 0.6, 0.75, 1]);
  });
});

describe('the autoplay rule, one at a time', () => {
  it('plays the video most in view once it is at least 0.6 in view, and stops it below', () => {
    const a = video('a');
    a.handle.setShare(0.5);
    expect(a.log).toEqual([]);
    a.handle.setShare(0.6);
    expect(a.log).toEqual(['play']);
    a.handle.setShare(0.9);
    expect(a.log).toEqual(['play']);
    a.handle.setShare(0.5);
    expect(a.log).toEqual(['play', 'stop']);
  });

  it('hands over when another becomes more in view, and never plays two', () => {
    const a = video('a');
    const b = video('b');
    a.handle.setShare(1);
    b.handle.setShare(0.7);
    expect(a.log).toEqual(['play']);
    expect(b.log).toEqual([]);
    b.handle.setShare(1);
    // Equal: the one playing keeps playing.
    expect(b.log).toEqual([]);
    a.handle.setShare(0.8);
    expect(a.log).toEqual(['play', 'stop']);
    expect(b.log).toEqual(['play']);
  });

  it('gives the slot of a video that drops out (its file failed) to the next one most in view', () => {
    const a = video('a');
    const b = video('b');
    const c = video('c');
    a.handle.setShare(1);
    b.handle.setShare(0.8);
    c.handle.setShare(0.65);
    expect(a.log).toEqual(['play']);
    // The failed player leaves the rule (VideoPlayer: playerModes gives it no autoplay).
    a.handle.leave();
    expect(b.log).toEqual(['play']);
    expect(c.log).toEqual([]);
    b.handle.leave();
    expect(c.log).toEqual(['play']);
  });

  it('does not stop a video that leaves the rule: the visitor may have taken it over', () => {
    const a = video('a');
    const b = video('b');
    a.handle.setShare(1);
    b.handle.setShare(0.9);
    a.handle.leave();
    expect(a.log).toEqual(['play']);
    // The next one most in view takes its place.
    expect(b.log).toEqual(['play']);
    a.handle.setShare(1);
    expect(a.log).toEqual(['play']);
  });
});

describe("the visitor's hold", () => {
  it('pauses every other player, plays nothing by itself until released, then resumes the rule', () => {
    const a = video('a');
    const b = video('b');
    a.handle.setShare(1);
    expect(a.log).toEqual(['play']);
    b.handle.leave();
    pb.holdPlayback('b', 'pause');
    expect(a.pause).toHaveBeenCalledTimes(1);
    expect(b.pause).not.toHaveBeenCalled();
    expect(a.log).toEqual(['play', 'pause', 'stop']);
    a.handle.setShare(0.9);
    expect(a.log).toEqual(['play', 'pause', 'stop']);
    pb.releasePlayback('b');
    expect(a.log).toEqual(['play', 'pause', 'stop', 'play']);
  });

  it('ends when the holding player leaves the page', () => {
    const a = video('a');
    const b = video('b');
    b.handle.leave();
    pb.holdPlayback('b', 'pause');
    a.handle.setShare(1);
    expect(a.log).toEqual(['pause']);
    b.unregister();
    expect(a.log).toEqual(['pause', 'play']);
  });

  it("holds for an embedded player until it leaves the page, whatever it reports", () => {
    const a = video('a');
    pb.registerPlayer('embed', () => undefined);
    pb.holdPlayback('embed', 'leave');
    a.handle.setShare(1);
    pb.releasePlayback('embed');
    expect(a.log).toEqual(['pause']);
  });

  it('holds while any audio plays when the audio player claims playback, and lets go when it stops', () => {
    const a = video('a');
    const audio = document.createElement('audio');
    document.body.append(audio);
    let paused = false;
    Object.defineProperty(audio, 'paused', { configurable: true, get: () => paused });
    pb.registerPlayer('audio', () => undefined);
    pb.claimPlayback('audio');
    a.handle.setShare(1);
    expect(a.log).toEqual(['pause']);
    paused = true;
    audio.dispatchEvent(new Event('pause'));
    expect(a.log).toEqual(['pause', 'play']);
    audio.remove();
  });
});

describe("the ledger: the page's play and pause events, told from the visitor's", () => {
  it('matches events to calls in order, when the calls run ahead of the events', () => {
    // A layer opens, closes, and opens again in one task (React's development double effect):
    // pause, play by the rule, pause. Three events follow, the element already paused.
    const ledger = new pb.PlaybackLedger();
    ledger.askedPause();
    ledger.autoStart();
    ledger.askedPause();
    expect(ledger.onPause()).toBe(true);
    expect(ledger.onPlay()).toBe(true);
    expect(ledger.onPause()).toBe(true);
    // Nothing left: the next events are the visitor's.
    expect(ledger.onPlay()).toBe(false);
    expect(ledger.onPause()).toBe(false);
  });

  it("counts a refused start out, so the visitor's next start is theirs", () => {
    const ledger = new pb.PlaybackLedger();
    ledger.autoStart();
    ledger.autoStartRefused();
    expect(ledger.onPlay()).toBe(false);
    ledger.autoStartRefused();
    ledger.autoStart();
    expect(ledger.onPlay()).toBe(true);
  });
});

describe('the lightbox layer', () => {
  it('pauses the players under it, plays only its own by themselves, and gives the page back on closing', () => {
    const page = video('page');
    page.handle.setShare(1);
    expect(page.log).toEqual(['play']);
    const close = pb.openLayer();
    expect(page.log).toEqual(['play', 'pause', 'stop']);
    const box = video('box', pb.LIGHTBOX_LAYER);
    box.handle.setShare(1);
    expect(box.log).toEqual(['play']);
    box.handle.leave();
    box.unregister();
    close();
    expect(page.log).toEqual(['play', 'pause', 'stop', 'play']);
    // Closing twice changes nothing.
    close();
    expect(page.log).toEqual(['play', 'pause', 'stop', 'play']);
  });

  it("ends a hold from under the layer, so the lightbox's own video may play", () => {
    // An embedded player names its layer, as EmbedPlayer does.
    const pauseEmbed = vi.fn();
    pb.registerPlayer('embed', pauseEmbed, 0);
    pb.holdPlayback('embed', 'leave');
    pb.openLayer();
    expect(pauseEmbed).toHaveBeenCalledTimes(1);
    const box = video('box', pb.LIGHTBOX_LAYER);
    box.handle.setShare(1);
    expect(box.log).toEqual(['play']);
  });

  it('leaves the audio player playing under the layer, and its hold with it', () => {
    const audio = document.createElement('audio');
    document.body.append(audio);
    let paused = false;
    Object.defineProperty(audio, 'paused', { configurable: true, get: () => paused });
    // Registered with no layer, as AudioEngine registers: it has nothing to see.
    const pauseAudio = vi.fn();
    pb.registerPlayer('audio', pauseAudio);
    pb.claimPlayback('audio');
    const close = pb.openLayer();
    expect(pauseAudio).not.toHaveBeenCalled();
    // While it plays, nothing plays by itself in the lightbox either.
    const box = video('box', pb.LIGHTBOX_LAYER);
    box.handle.setShare(1);
    expect(box.log).toEqual([]);
    paused = true;
    audio.dispatchEvent(new Event('pause'));
    expect(box.log).toEqual(['play']);
    box.handle.leave();
    box.unregister();
    close();
    expect(pauseAudio).not.toHaveBeenCalled();
    audio.remove();
  });

  it('counts a lightbox player that joined before the layer opened', () => {
    const box = video('box', pb.LIGHTBOX_LAYER);
    box.handle.setShare(1);
    expect(box.log).toEqual(['play']);
    pb.openLayer();
    expect(box.pause).not.toHaveBeenCalled();
    expect(box.log).toEqual(['play']);
  });
});
