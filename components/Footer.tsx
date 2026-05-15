import type { Content } from '@/lib/types';

export default function Footer({ content }: { content: Content }) {
  const year = new Date().getFullYear();
  return (
    <footer className="mt-32 border-t border-white/8" style={{ borderTopColor: 'rgb(255 255 255 / 0.08)' }}>
      <div className="wrap flex flex-col items-start gap-3 py-10 md:flex-row md:items-center md:justify-between">
        <div className="font-mono text-xs uppercase tracking-widest text-ink-mute">
          © {year} {content.personal.name}
        </div>
        <div className="font-mono text-xs text-ink-mute">
          {content.personal.tagline}
        </div>
      </div>
    </footer>
  );
}
