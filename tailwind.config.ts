import type { Config } from 'tailwindcss';

/**
 * A token from app/tokens.css as a Tailwind color. The tokens are full colors (hex or rgba), so an
 * opacity modifier (`bg-night/90`) mixes the token with transparent.
 */
const token = (name: string) => `color-mix(in srgb, var(--${name}) calc(<alpha-value> * 100%), transparent)`;

/**
 * Tailwind 3 on the design tokens (app/tokens.css; Phase 1 moves this to Tailwind 4 `@theme`).
 * The names are the tokens' own. Renamed from Phase 3: bg to sheet, surface to sheet-2,
 * surface-2 to sheet-3, accent to line (links, focus, drawing lines), the old hairline `line` to
 * rule, well to night, well-ink to on-night, accent-contrast to on-action.
 */
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        sheet: token('sheet'),
        'sheet-2': token('sheet-2'),
        'sheet-3': token('sheet-3'),
        night: token('night'),
        ink: token('ink'),
        'ink-dim': token('ink-dim'),
        'ink-mute': token('ink-mute'),
        line: token('line'),
        rule: token('rule'),
        glass: token('glass'),
        action: token('action'),
        'on-action': token('on-action'),
        'on-night': token('on-night'),
        'night-rule': token('night-rule'),
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
        mono: ['var(--font-mono)'],
      },
      maxWidth: {
        wrap: 'var(--max-content)',
        article: '760px',
        measure: 'var(--measure)',
      },
      borderRadius: {
        DEFAULT: 'var(--radius)',
        sm: 'var(--radius)',
        md: 'var(--radius)',
        lg: 'var(--radius)',
        pill: 'var(--radius-pill)',
      },
      boxShadow: {
        card: 'var(--shadow-card)',
      },
      transitionTimingFunction: {
        out: 'cubic-bezier(0.2, 0.7, 0.2, 1)',
      },
    },
  },
  plugins: [],
};

export default config;
