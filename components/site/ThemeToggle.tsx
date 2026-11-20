'use client';

import { useSyncExternalStore } from 'react';
import { currentTheme, THEMES, type Theme } from '@/lib/theme';
import { switchTheme } from './themeFade';

export interface ThemeToggleLabels {
  /** The group's name ("Theme"). */
  group: string;
  blueprint: string;
  whiteprint: string;
  /** The options' names in the compact toggle, which shows no words ("Blueprint theme"). */
  blueprintTheme: string;
  whiteprintTheme: string;
}

/** Every toggle on the page follows <html data-theme>, so the nav's and the menu's agree. */
function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
}

/**
 * The theme toggle (bundle ThemeToggle, bundle.css 7): two options, Blueprint and Whiteprint, each
 * a button with aria-pressed. `compact` (the desktop nav) shows two swatches drawn in each theme's
 * own sheet and line, with the words as accessible names; `full` (the phone menu) shows the words.
 * The choice is kept in the `theme` cookie that the head script reads before the first paint. The
 * page cross-fades to the new theme in 300 ms while the toggle's own state changes at once
 * (./themeFade.ts, motion sheet 7.6); under reduced motion the theme changes at once. The words
 * come from the server (lib/strings.ts), so the site-wide script chunk does not carry the strings
 * module.
 */
export default function ThemeToggle({
  variant,
  labels,
  initial,
}: {
  variant: 'compact' | 'full';
  labels: ThemeToggleLabels;
  /** The theme the server rendered (the content's default), until the browser knows the visitor's. */
  initial: Theme;
}) {
  const theme = useSyncExternalStore(subscribe, currentTheme, () => initial);
  return (
    <div className={`ar-theme ar-theme--${variant}`} role="group" aria-label={labels.group}>
      {THEMES.map((option) => {
        const name = option === 'blueprint' ? labels.blueprint : labels.whiteprint;
        const compactName = option === 'blueprint' ? labels.blueprintTheme : labels.whiteprintTheme;
        return (
          <button
            key={option}
            type="button"
            className="ar-theme__opt"
            data-value={option}
            aria-pressed={theme === option}
            aria-label={variant === 'compact' ? compactName : undefined}
            title={variant === 'compact' ? name : undefined}
            onClick={() => switchTheme(option)}
          >
            <span data-theme={option} className="ar-theme__swatch" aria-hidden="true" />
            {variant === 'full' ? <span>{name}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
