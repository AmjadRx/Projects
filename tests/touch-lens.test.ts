import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TouchLensMachine } from '../components/home/hero/touchMachine';
import { hero, toMs } from '../lib/motion';

/** The machine with its effects recorded and real timers (faked by Vitest). */
function setup() {
  const calls: string[] = [];
  const machine = new TouchLensMachine({
    show: (p, jump) => calls.push(`show ${p.x},${p.y} ${jump ? 'jump' : 'spring'}`),
    follow: (p) => calls.push(`follow ${p.x},${p.y}`),
    hide: (seconds) => calls.push(`hide ${toMs(seconds)}`),
    later: (ms, run) => {
      const id = setTimeout(run, ms);
      return () => clearTimeout(id);
    },
  });
  return { machine, calls };
}

describe('the touch lens (motion sheet 4.2; hero.touch)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the lens at the finger, follows it, holds after the lift, then fades out', () => {
    const { machine, calls } = setup();
    machine.down(1, { x: 300, y: 300 });
    machine.move(1, { x: 340, y: 300 });
    machine.up(1);
    expect(calls).toEqual(['show 300,300 jump', 'follow 340,300']);
    vi.advanceTimersByTime(toMs(hero.touch.hold) - 1);
    expect(calls).toHaveLength(2);
    expect(machine.showing).toBe(true);
    vi.advanceTimersByTime(1);
    expect(calls.at(-1)).toBe(`hide ${toMs(hero.touch.fadeOut)}`);
    expect(machine.showing).toBe(true);
    vi.advanceTimersByTime(toMs(hero.touch.fadeOut));
    expect(machine.showing).toBe(false);
  });

  it('shows a tap that does not move for the same hold', () => {
    const { machine, calls } = setup();
    machine.down(4, { x: 200, y: 250 });
    machine.up(4);
    vi.advanceTimersByTime(toMs(hero.touch.hold));
    expect(calls).toEqual(['show 200,250 jump', `hide ${toMs(hero.touch.fadeOut)}`]);
  });

  it('fades out fast when the browser takes the gesture for scrolling', () => {
    const { machine, calls } = setup();
    machine.down(2, { x: 300, y: 300 });
    machine.cancel(2);
    expect(calls).toEqual(['show 300,300 jump', `hide ${toMs(hero.touch.cancelFadeOut)}`]);
    vi.advanceTimersByTime(toMs(hero.touch.hold) * 2);
    expect(calls).toHaveLength(2);
    expect(machine.showing).toBe(false);
  });

  it('moves a lens still in sight to a new press instead of jumping, and cancels the pending fade', () => {
    const { machine, calls } = setup();
    machine.down(1, { x: 300, y: 300 });
    machine.up(1);
    vi.advanceTimersByTime(toMs(hero.touch.hold) + 10);
    machine.down(2, { x: 100, y: 100 });
    expect(calls.at(-1)).toBe('show 100,100 spring');
    vi.advanceTimersByTime(toMs(hero.touch.fadeOut) * 2);
    expect(machine.showing).toBe(true);
    machine.up(2);
    vi.advanceTimersByTime(toMs(hero.touch.hold) + toMs(hero.touch.fadeOut));
    expect(machine.showing).toBe(false);
    machine.down(3, { x: 400, y: 400 });
    expect(calls.at(-1)).toBe('show 400,400 jump');
  });

  it('follows the first finger only', () => {
    const { machine, calls } = setup();
    machine.down(1, { x: 300, y: 300 });
    machine.down(2, { x: 50, y: 50 });
    machine.move(2, { x: 60, y: 60 });
    machine.up(2);
    machine.cancel(2);
    expect(calls).toEqual(['show 300,300 jump']);
  });

  it('stops every timer when it is disposed', () => {
    const { machine, calls } = setup();
    machine.down(1, { x: 300, y: 300 });
    machine.up(1);
    machine.dispose();
    vi.advanceTimersByTime(toMs(hero.touch.hold) * 3);
    expect(calls).toEqual(['show 300,300 jump']);
    expect(machine.showing).toBe(false);
  });
});
