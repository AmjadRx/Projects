interface SectionHeaderProps {
  num: string;
  eyebrow: string;
  title: string;
  lead?: string;
  align?: 'left' | 'between';
  right?: React.ReactNode;
}

export default function SectionHeader({
  num,
  eyebrow,
  title,
  lead,
  align = 'left',
  right,
}: SectionHeaderProps) {
  return (
    <header
      className={
        align === 'between'
          ? 'mb-12 flex flex-col gap-8 md:mb-16 md:flex-row md:items-end md:justify-between'
          : 'mb-12 md:mb-16'
      }
    >
      <div className="max-w-3xl">
        <div className="section-eyebrow">
          <span className="text-cyan">{num}</span>
          <span
            className="inline-block h-px w-8"
            style={{ background: 'rgb(255 255 255 / 0.2)' }}
          />
          <span>{eyebrow}</span>
        </div>
        <h2 className="display-lg mt-4 text-ink">{title}</h2>
        {lead && <p className="lead mt-5 max-w-2xl">{lead}</p>}
      </div>
      {right && <div className="md:pb-2">{right}</div>}
    </header>
  );
}
