/**
 * The inline head script (lib/theme.ts), run as the browser runs it, before the first paint: the
 * theme from the cookie, the still image's step and its URLs for the sky (Phase 5), and the
 * visitor's pause-motion choice. Each part works when another's browser API is blocked.
 */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { SKY, stored } from '../lib/motion';
import { STILL_FALLBACK_STEP, STILL_STEPS, stillStepAt } from '../lib/sky/still-steps';
import { chooseTier } from '../lib/sky/tier';
import {
  STILL_CLASSES,
  blueprintStillUrl,
  parseSkyStep,
  stillStepName,
  stillVar,
  themeFromCookie,
  themeFromSetting,
  themeScript,
  type Theme,
} from '../lib/theme';

interface Run {
  attrs: Map<string, string>;
  vars: Map<string, string>;
}

/** Runs the head script in a fresh context with a fake document, clock and storage. */
function run(
  fallback: Theme,
  {
    cookie = '',
    now = Date.UTC(2026, 10, 17, 5, 0, 0),
    storage = {} as Record<string, string>,
    cookieThrows = false,
    storageThrows = false,
  } = {},
): Run {
  const attrs = new Map<string, string>();
  const vars = new Map<string, string>();
  const documentElement = {
    setAttribute: (name: string, value: string) => void attrs.set(name, String(value)),
    style: { setProperty: (name: string, value: string) => void vars.set(name, value) },
  };
  const document = {
    documentElement,
    get cookie(): string {
      if (cookieThrows) throw new Error('blocked');
      return cookie;
    },
  };
  const localStorage = {
    getItem(key: string): string | null {
      if (storageThrows) throw new Error('blocked');
      return Object.hasOwn(storage, key) ? storage[key] : null;
    },
  };
  const FixedDate = class extends Date {
    static now(): number {
      return now;
    }
  };
  vm.runInNewContext(themeScript(fallback), { document, localStorage, Date: FixedDate });
  return { attrs, vars };
}

describe('the head script: the theme', () => {
  it('takes the cookie, either name or the older dark and light', () => {
    expect(run('blueprint', { cookie: 'theme=whiteprint' }).attrs.get('data-theme')).toBe('whiteprint');
    expect(run('whiteprint', { cookie: 'a=1; theme=blueprint; b=2' }).attrs.get('data-theme')).toBe('blueprint');
    expect(run('blueprint', { cookie: 'theme=light' }).attrs.get('data-theme')).toBe('whiteprint');
    expect(run('whiteprint', { cookie: 'theme=dark' }).attrs.get('data-theme')).toBe('blueprint');
  });

  it('falls back to the content default without a cookie, with an unknown one, or when cookies are blocked', () => {
    expect(run('whiteprint').attrs.get('data-theme')).toBe('whiteprint');
    expect(run('blueprint', { cookie: 'theme=sepia' }).attrs.get('data-theme')).toBe('blueprint');
    expect(run('blueprint', { cookie: 'xtheme=whiteprint' }).attrs.get('data-theme')).toBe('blueprint');
    expect(run('whiteprint', { cookieThrows: true }).attrs.get('data-theme')).toBe('whiteprint');
  });

  it('reads cookie values the way the server helpers do', () => {
    expect(themeFromCookie('dark')).toBe('blueprint');
    expect(themeFromCookie('whiteprint')).toBe('whiteprint');
    expect(themeFromCookie('sepia')).toBeNull();
    expect(themeFromSetting('light')).toBe('whiteprint');
    expect(themeFromSetting('dark')).toBe('blueprint');
  });
});

describe('the head script: the still sky', () => {
  it('records the step nearest the sky over Santa Clara now, as stillStepAt computes it', () => {
    const start = Date.UTC(2026, 10, 18, 0, 0, 0);
    const seen = new Set<number>();
    // Every 23 minutes for two days crosses every step, and many half-hour boundaries.
    for (let ms = start; ms < start + 2 * 86_400_000; ms += 23 * 60_000) {
      const step = Number(run('blueprint', { now: ms }).attrs.get('data-sky-step'));
      expect(step, new Date(ms).toISOString()).toBe(stillStepAt(ms));
      seen.add(step);
    }
    expect(seen.size).toBe(STILL_STEPS);
  });

  it("points each width class at that step's Blueprint still", () => {
    const now = Date.UTC(2026, 10, 18, 3, 30, 0);
    const { vars } = run('blueprint', { now });
    const step = stillStepAt(now);
    expect([...vars.keys()].sort()).toEqual(STILL_CLASSES.map(stillVar).sort());
    for (const widthClass of STILL_CLASSES) {
      expect(vars.get(stillVar(widthClass))).toBe(`url("${blueprintStillUrl(widthClass, step)}")`);
    }
  });

  it('names the stills by class and a two-digit step', () => {
    expect(blueprintStillUrl('phone', 7)).toBe('/sky/still/blueprint-phone-07.webp');
    expect(blueprintStillUrl('desktop', 23)).toBe('/sky/still/blueprint-desktop-23.webp');
    expect(stillStepName(0)).toBe('00');
    expect(stillVar('tablet')).toBe('--sky-still-tablet');
    expect(STILL_FALLBACK_STEP).toBeGreaterThanOrEqual(0);
    expect(STILL_FALLBACK_STEP).toBeLessThan(STILL_STEPS);
  });

  it('reads data-sky-step back only when it is a step', () => {
    expect(parseSkyStep('0')).toBe(0);
    expect(parseSkyStep('7')).toBe(7);
    expect(parseSkyStep('07')).toBe(7);
    expect(parseSkyStep('23')).toBe(23);
    for (const bad of ['24', '-1', '7.5', ' 7', '', 'x', null, undefined]) expect(parseSkyStep(bad), String(bad)).toBeNull();
  });

  it('still sets the theme and the pause mark when the sky part cannot run', () => {
    // A clock that throws: the step's part stops, the other parts go on.
    const attrs = new Map<string, string>();
    const documentElement = { setAttribute: (n: string, v: string) => void attrs.set(n, v), style: { setProperty() {} } };
    const localStorage = { getItem: (key: string) => (key === stored.motionPaused ? '1' : null) };
    const BrokenDate = {
      now(): number {
        throw new Error('no clock');
      },
    };
    vm.runInNewContext(themeScript('whiteprint'), { document: { documentElement, cookie: '' }, localStorage, Date: BrokenDate });
    expect(attrs.get('data-theme')).toBe('whiteprint');
    expect(attrs.has('data-sky-step')).toBe(false);
    expect(attrs.get('data-motion-paused')).toBe('true');
  });
});

describe('the head script: the pause-motion choice', () => {
  it('marks <html data-motion-paused> only while the stored choice is paused', () => {
    expect(run('blueprint', { storage: { [stored.motionPaused]: '1' } }).attrs.get('data-motion-paused')).toBe('true');
    expect(run('blueprint').attrs.has('data-motion-paused')).toBe(false);
    expect(run('blueprint', { storage: { [stored.motionPaused]: '0' } }).attrs.has('data-motion-paused')).toBe(false);
  });

  it('leaves the theme and the sky working when storage is blocked', () => {
    const { attrs, vars } = run('whiteprint', { storageThrows: true, cookie: 'theme=blueprint' });
    expect(attrs.get('data-theme')).toBe('blueprint');
    expect(attrs.has('data-sky-step')).toBe(true);
    expect(vars.size).toBe(STILL_CLASSES.length);
    expect(attrs.has('data-motion-paused')).toBe(false);
  });
});

describe("the head script: the sky's Light tier before the first paint", () => {
  interface Device {
    fine?: boolean;
    reduced?: boolean;
    memory?: number;
    cores?: number;
    saveData?: boolean;
    webgl2?: boolean;
    paused?: boolean;
  }

  /** Runs the head script with a device's media queries, hints and APIs; returns data-sky-tier. */
  function tierFor({ fine = true, reduced = false, memory = 8, cores = 8, saveData = false, webgl2 = true, paused = false }: Device = {}): string | undefined {
    const attrs = new Map<string, string>();
    const documentElement = { setAttribute: (n: string, v: string) => void attrs.set(n, v), style: { setProperty() {} } };
    const matchMedia = (query: string) => ({
      matches: query === '(pointer: fine)' ? fine : query === '(prefers-reduced-motion: reduce)' ? reduced : false,
    });
    vm.runInNewContext(themeScript('blueprint'), {
      document: { documentElement, cookie: '' },
      localStorage: { getItem: (key: string) => (paused && key === stored.motionPaused ? '1' : null) },
      Date,
      matchMedia,
      navigator: { deviceMemory: memory, hardwareConcurrency: cores, connection: { saveData } },
      ...(webgl2 ? { WebGL2RenderingContext: function WebGL2RenderingContext() {} } : {}),
    });
    return attrs.get('data-sky-tier');
  }

  it('marks the Light tier from the hints chooseTier uses: a coarse pointer, or little memory or few cores', () => {
    expect(tierFor({ fine: false })).toBe('light');
    expect(tierFor({ memory: SKY.tiers.lightMemoryGb })).toBe('light');
    expect(tierFor({ cores: SKY.tiers.lightCores })).toBe('light');
    expect(tierFor()).toBeUndefined();
  });

  it('leaves it to the host when the sky will be still (reduced motion, Save-Data, paused, no WebGL2)', () => {
    for (const device of [{ reduced: true }, { saveData: true }, { paused: true }, { webgl2: false }] as Device[]) {
      expect(tierFor({ ...device, fine: false }), JSON.stringify(device)).toBeUndefined();
    }
  });

  it('agrees with the host', () => {
    for (const fine of [true, false]) {
      for (const memory of [2, 4, 8]) {
        for (const cores of [2, 4, 8]) {
          const host = chooseTier({ reducedMotion: false, saveData: false, paused: false, webgl2: true, finePointer: fine, memoryGb: memory, cores });
          expect(tierFor({ fine, memory, cores }) ?? 'full', JSON.stringify({ fine, memory, cores })).toBe(host);
        }
      }
    }
  });
});

describe('the head script as text', () => {
  it('is one expression with no doubled braces, no dashes, and only the two theme names', () => {
    for (const theme of ['blueprint', 'whiteprint'] as const) {
      const script = themeScript(theme);
      expect(script).not.toMatch(/\{\{|\}\}/);
      // The en and em dashes, built from their code points so this file holds neither.
      expect(script).not.toMatch(new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`));
      expect(script.startsWith('(function(){')).toBe(true);
      expect(script.endsWith('})();')).toBe(true);
      expect(() => new vm.Script(script)).not.toThrow();
    }
  });
});
