/**
 * The two themes (DESIGN_DIRECTION.md 2): Blueprint, the default, and Whiteprint. The visitor's
 * choice lives in the `theme` cookie, which the inline head script in app/layout.tsx reads before
 * the first paint, so the page never flashes. Cookies set before Phase 4 say `dark` or `light`;
 * they still work. Safe in server and browser code.
 */
export const THEMES = ['blueprint', 'whiteprint'] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_COOKIE = 'theme';
const ONE_YEAR = 60 * 60 * 24 * 365;

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
 * The head script: the cookie's theme, else `fallback`, on <html data-theme> before the first
 * paint. `fallback` is always one of the two names (themeFromSetting), never content text.
 */
export function themeScript(fallback: Theme): string {
  // Written without doubled braces, which the content check reads as template placeholders.
  return `(function(){var t='${fallback}';try{var m=document.cookie.match(/(?:^|; )theme=(blueprint|whiteprint|dark|light)(?:;|$)/);if(m)t=m[1]==='dark'?'blueprint':m[1]==='light'?'whiteprint':m[1];}catch(e){}document.documentElement.setAttribute('data-theme',t);})();`;
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
