// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** What the stand-in leaves report: "+name" when one mounts, "-name" when it unmounts. */
const state = vi.hoisted(() => ({ motionOk: true, paused: false, log: [] as string[] }));

vi.mock('next/navigation', () => ({ usePathname: () => '/' }));
vi.mock('../lib/useMotionOk', () => ({ useMotionOk: () => state.motionOk }));
vi.mock('../lib/motionPause', () => ({ useMotionPaused: () => state.paused }));

function leaf(name: string) {
  return async () => {
    const { useEffect } = await import('react');
    return {
      default: function Leaf() {
        useEffect(() => {
          state.log.push(`+${name}`);
          return () => {
            state.log.push(`-${name}`);
          };
        }, []);
        return null;
      },
    };
  };
}
vi.mock('../components/home/hero/RotorTilt', leaf('tilt'));
vi.mock('../components/home/hero/PointerLens', leaf('pointer'));
vi.mock('../components/home/hero/TouchLens', leaf('touch'));

const { default: DrawingStage } = await import('../components/home/hero/DrawingStage');
const { FINE_POINTER } = await import('../components/home/hero/hooks');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function pointer(fine: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: fine && query === FINE_POINTER,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
}

let root: Root | null = null;

/** Renders the drawing's stage in a hero section, as HeroDrawing does. */
function stage(key = 0) {
  if (!root) {
    const section = document.createElement('section');
    section.className = 'hm-hero';
    document.body.append(section);
    root = createRoot(section);
  }
  const r = root;
  act(() => r.render(createElement(DrawingStage, null, createElement('svg', { className: 'hd-svg', 'data-render': key }))));
}

describe('DrawingStage mounts what needs a script only while motion is allowed', () => {
  beforeEach(() => {
    state.motionOk = true;
    state.paused = false;
    state.log = [];
    sessionStorage.clear();
    document.documentElement.removeAttribute('data-intro-seen');
  });

  afterEach(() => {
    const r = root;
    if (r) act(() => r.unmount());
    root = null;
    document.body.replaceChildren();
  });

  it('a mouse or a pen: the rotor tilt and the pointer lens', () => {
    pointer(true);
    stage();
    expect(state.log).toEqual(['+tilt', '+pointer']);
  });

  it('touch: the rotor tilt and the touch lens', () => {
    pointer(false);
    stage();
    expect(state.log).toEqual(['+tilt', '+touch']);
  });

  it('reduced motion (or /admin): nothing, so the drawing keeps its static split', () => {
    pointer(true);
    state.motionOk = false;
    stage();
    expect(state.log).toEqual([]);
  });

  it('motion paused in the footer: nothing', () => {
    pointer(false);
    state.paused = true;
    stage();
    expect(state.log).toEqual([]);
  });

  it('turning motion off during a visit unmounts every leaf, and turning it on mounts them again', () => {
    pointer(true);
    stage(1);
    state.motionOk = false;
    stage(2);
    expect(state.log).toEqual(['+tilt', '+pointer', '-tilt', '-pointer']);
    state.motionOk = true;
    state.paused = true;
    stage(3);
    expect(state.log).toHaveLength(4);
    state.paused = false;
    stage(4);
    expect(state.log.slice(4)).toEqual(['+tilt', '+pointer']);
  });
});
