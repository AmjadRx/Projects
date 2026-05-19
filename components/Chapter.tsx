import { type ReactNode } from 'react';

interface ChapterProps {
  num: string;
  eyebrow: string;
  title: ReactNode;
  lead?: ReactNode;
  align?: 'left' | 'center';
  right?: ReactNode;
}

export default function Chapter({
  num,
  eyebrow,
  title,
  lead,
  align = 'left',
  right,
}: ChapterProps) {
  return (
    <header
      className={
        align === 'center'
          ? 'mx-auto mb-14 max-w-[820px] text-center md:mb-20'
          : 'mb-14 md:mb-20'
      }
    >
      <div className={align === 'center' ? 'flex justify-center' : ''}>
        <span className="eyebrow">
          <span className="eyebrow-num">{num}</span>
          <span className="eyebrow-rule" />
          <span>{eyebrow}</span>
        </span>
      </div>

      <div
        className={
          align === 'center'
            ? 'mt-6'
            : right
              ? 'mt-6 flex flex-col gap-8 md:flex-row md:items-end md:justify-between'
              : 'mt-6'
        }
      >
        <h2 className={`display-xl text-balance max-w-[18ch] ${align === 'center' ? 'mx-auto' : ''}`}>
          {title}
        </h2>
        {right && <div className="shrink-0 md:pb-3">{right}</div>}
      </div>

      {lead && (
        <p
          className={`lead text-pretty mt-6 max-w-[58ch] ${
            align === 'center' ? 'mx-auto' : ''
          }`}
        >
          {lead}
        </p>
      )}
    </header>
  );
}
