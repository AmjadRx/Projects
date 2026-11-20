/**
 * The theme cross-fade (DESIGN_DIRECTION.md 6.3; motion sheet 7.6): toggling the theme fades the
 * whole page from Blueprint to Whiteprint, or back, in 300 ms (fade), through
 * document.startViewTransition: the browser keeps a picture of the old page, the theme changes
 * under it, and the old picture fades out over the live new page, so the sky changes with it,
 * stars to paper. The toggle's own state changes at once: while the attribute THEME_FADE_ATTR is
 * on <html>, each toggle takes its own view-transition-name, and app/motion-chrome.css shows the
 * new toggle with no fade. Under reduced motion, or where the browser has no View Transitions, the
 * theme changes at once.
 *
 * The theme itself still changes through applyTheme (lib/theme.ts), inside the transition: the
 * same attribute, the same cookie for the head script, and the sky's host still hears the change
 * through its observer on <html data-theme>.
 */
import { applyTheme, currentTheme, type Theme } from '@/lib/theme';
import { motionOk } from '@/lib/useMotionOk';

/** On <html> for the length of one cross-fade (app/motion-chrome.css reads it). */
export const THEME_FADE_ATTR = 'data-theme-fade';

/** Counts the cross-fades, so a toggle pressed again mid-fade keeps the attribute until its own fade ends. */
let fades = 0;

/** Shows `theme`: cross-faded where motion may play and the browser can, at once otherwise. */
export function switchTheme(theme: Theme): void {
  const doc = document as Partial<Pick<Document, 'startViewTransition'>> & Document;
  if (theme === currentTheme() || !motionOk() || typeof doc.startViewTransition !== 'function') {
    applyTheme(theme);
    return;
  }
  const html = doc.documentElement;
  const fade = ++fades;
  const done = () => {
    if (fade === fades) html.removeAttribute(THEME_FADE_ATTR);
  };
  html.setAttribute(THEME_FADE_ATTR, '');
  try {
    const transition = doc.startViewTransition(() => applyTheme(theme));
    // A skipped transition (a hidden tab, a newer one) still applies the theme; nothing to report.
    transition.ready.catch(() => {});
    transition.updateCallbackDone.catch(() => {});
    transition.finished.then(done, done);
  } catch {
    done();
    applyTheme(theme);
  }
}
