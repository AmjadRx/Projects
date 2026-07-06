interface MarqueeProps {
  items: string[];
}

/** Slow, pausable keyword marquee. CSS animation; static under reduced motion. */
export default function Marquee({ items }: MarqueeProps) {
  const row = items.map((item, i) => (
    <span key={i} className="flex shrink-0 items-center gap-6">
      <span className="font-mono text-xs uppercase tracking-[0.18em] text-ink-mute">{item}</span>
      <span className="text-ink-mute/50" aria-hidden>·</span>
    </span>
  ));
  return (
    <div
      className="marquee overflow-hidden py-5"
      style={{ borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)' }}
      aria-hidden
    >
      <div className="marquee-track flex w-max items-center gap-6">
        {row}
        {row}
      </div>
    </div>
  );
}
