/**
 * The two themes (DESIGN_DIRECTION.md 2): Blueprint, the default, and Whiteprint. The visitor's
 * choice lives in the `theme` cookie, which the inline head script in app/layout.tsx reads before
 * the first paint, so the page never flashes. Cookies set before Phase 4 say `dark` or `light`;
 * they still work. Safe in server and browser code.
 *
 * The same head script readies the sky's first paint (Phase 5): it picks the still image's step,
 * the hourly sidereal step nearest the sky over Santa Clara now (lib/sky/still-steps.ts), records
 * it as data-sky-step on <html> for the live sky to start from, and points one custom property per
 * width class at that step's Blueprint still (app/sheet.css 23 shows it). It also reads the
 * visitor's pause-motion choice (lib/motionPause.ts) and marks <html data-motion-paused>.
 */
import { SKY, stored } from './motion';
import { STILL_STEPS, STILL_STEP_SCRIPT } from './sky/still-steps';

export const THEMES = ['blueprint', 'whiteprint'] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_COOKIE = 'theme';
const ONE_YEAR = 60 * 60 * 24 * 365;

/** The still image's width classes: phone under 768 px, tablet 768 to 1023 px, desktop 1024 px and up. */
export const STILL_CLASSES = ['phone', 'tablet', 'desktop'] as const;
export type StillClass = (typeof STILL_CLASSES)[number];

/** Where the still images live (public/sky/still/), as the page asks for them. */
export const STILL_DIR = '/sky/still/';

/** A step as the still files name it: two digits, 00 to 23. */
export function stillStepName(step: number): string {
  return String(step).padStart(2, '0');
}

/** The Blueprint still of a width class at a step: public/sky/still/blueprint-<class>-<step>.webp. */
export function blueprintStillUrl(widthClass: StillClass, step: number): string {
  return `${STILL_DIR}blueprint-${widthClass}-${stillStepName(step)}.webp`;
}

/** The custom property on <html> that holds a width class's Blueprint still, as a CSS url(). */
export function stillVar(widthClass: StillClass): string {
  return `--sky-still-${widthClass}`;
}

/** The step in data-sky-step, read back: an integer from 0 to 23, or null when it is anything else. */
export function parseSkyStep(value: string | null | undefined): number | null {
  if (typeof value !== 'string' || !/^\d{1,2}$/.test(value)) return null;
  const step = Number(value);
  return step < STILL_STEPS ? step : null;
}

/** The content's `settings.themeDefault` ("dark" or "light", schema-checked) as a theme. */
export function themeFromSetting(setting: string): Theme {
  return setting === 'light' ? 'whiteprint' : 'blueprint';
}

/** A stored cookie value as a theme: either name, or the older `dark` and `light`. Null otherwise. */
export function themeFromCookie(value: string | null | undefined): Theme | null {
  if (value === 'blueprint' || value === 'dark') return 'blueprint';
  if (value === 'whiteprint' || value === 'light') return 'whiteprint';
  return null;
}

/**
 * The head script, run before the first paint:
 * - the cookie's theme, else `fallback`, on <html data-theme>. `fallback` is always one of the two
 *   names (themeFromSetting), never content text;
 * - the still's step as <html data-sky-step> (0 to 23), and for each width class the custom
 *   property `stillVar(class)` set to that step's Blueprint still, url("/sky/still/...");
 * - <html data-motion-paused="true"> when the visitor has paused motion;
 * - <html data-sky-tier="light"> when the device's own hints already choose the sky's Light tier
 *   (lib/sky/tier.ts chooseTier: a coarse pointer, or SKY.tiers.lightMemoryGb of memory or
 *   SKY.tiers.lightCores cores or fewer, with motion allowed, Save-Data off and WebGL2 present), so
 *   the Light tier's glass (app/sheet.css 24) is there from the first paint instead of arriving
 *   after hydration. The sky's host (components/sky/host.ts) then keeps the attribute up to date.
 * Each part sits in its own try, so a blocked cookie, storage or API leaves the others working.
 */
export function themeScript(fallback: Theme): string {
  const classes = STILL_CLASSES.map((widthClass) => `'${widthClass}'`).join(',');
  // Written without doubled braces, which the content check reads as template placeholders.
  return (
    `(function(){var d=document.documentElement,t='${fallback}',p=false;` +
    `try{var m=document.cookie.match(/(?:^|; )theme=(blueprint|whiteprint|dark|light)(?:;|$)/);if(m)t=m[1]==='dark'?'blueprint':m[1]==='light'?'whiteprint':m[1];}catch(e){}` +
    `d.setAttribute('data-theme',t);` +
    `try{var s=(${STILL_STEP_SCRIPT})(Date.now()),n=(s<10?'0':'')+s,k=[${classes}],i;d.setAttribute('data-sky-step',String(s));` +
    `for(i=0;i<k.length;i++)d.style.setProperty('--sky-still-'+k[i],'url("${STILL_DIR}blueprint-'+k[i]+'-'+n+'.webp")');}catch(e){}` +
    `try{p=localStorage.getItem('${stored.motionPaused}')==='1';}catch(e){}if(p)d.setAttribute('data-motion-paused','true');` +
    `try{var v=navigator,c=v.connection,q=function(x){return matchMedia(x).matches;};` +
    `if(!p&&!q('(prefers-reduced-motion: reduce)')&&!(c&&c.saveData)&&typeof WebGL2RenderingContext==='function'&&` +
    `(!q('(pointer: fine)')||v.deviceMemory<=${SKY.tiers.lightMemoryGb}||v.hardwareConcurrency<=${SKY.tiers.lightCores}))d.setAttribute('data-sky-tier','light');}catch(e){};})();`
  );
}

/** The theme the page shows now. Browser only. */
export function currentTheme(): Theme {
  return document.documentElement.getAttribute('data-theme') === 'whiteprint' ? 'whiteprint' : 'blueprint';
}

/** Shows a theme and remembers it for a year (no tracking: the cookie holds only the choice). Browser only. */
export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
  document.cookie = `${THEME_COOKIE}=${theme}; Path=/; Max-Age=${ONE_YEAR}; SameSite=Lax`;
}
