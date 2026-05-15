import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        cyan: {
          DEFAULT: 'rgb(var(--color-cyan) / <alpha-value>)',
        },
        navy: {
          DEFAULT: 'rgb(var(--color-navy) / <alpha-value>)',
          2: 'rgb(var(--color-navy-2) / <alpha-value>)',
          3: 'rgb(var(--color-navy-3) / <alpha-value>)',
        },
        purple: {
          DEFAULT: 'rgb(var(--color-purple) / <alpha-value>)',
        },
        ink: {
          DEFAULT: 'rgb(var(--color-ink) / <alpha-value>)',
          dim: 'rgb(var(--color-ink-dim) / <alpha-value>)',
          mute: 'rgb(var(--color-ink-mute) / <alpha-value>)',
        },
      },
      fontFamily: {
        display: ['var(--font-display)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
      maxWidth: {
        wrap: '1240px',
      },
      opacity: {
        3: '0.03',
        8: '0.08',
        15: '0.15',
      },
      boxShadow: {
        glow: '0 0 40px -10px rgb(var(--color-cyan) / 0.3)',
        'glow-purple': '0 0 40px -10px rgb(var(--color-purple) / 0.3)',
      },
      animation: {
        'spin-slow': 'spin 20s linear infinite',
        'spin-reverse': 'spin-reverse 30s linear infinite',
        fade: 'fade 0.4s ease-out',
      },
      keyframes: {
        'spin-reverse': {
          from: { transform: 'rotate(360deg)' },
          to: { transform: 'rotate(0deg)' },
        },
        fade: {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
