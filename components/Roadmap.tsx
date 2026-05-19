import type { RoadmapStage } from '@/lib/types';
import { cn } from '@/lib/utils';

const statusBadge: Record<RoadmapStage['status'], string> = {
  'in-progress': 'In progress',
  next: 'Next',
  future: 'Future',
};

export default function Roadmap({ stages }: { stages: RoadmapStage[] }) {
  return (
    <div className="-mx-6 overflow-x-auto px-6 pb-4 md:mx-0 md:px-0">
      <div className="grid min-w-[1100px] grid-cols-8 gap-px overflow-hidden rounded-2xl md:min-w-0" style={{ background: 'rgb(var(--line) / 0.1)' }}>
        {stages.map((s) => {
          const isCurrent = s.status === 'in-progress';
          const isNext = s.status === 'next';
          return (
            <div
              key={s.n}
              className={cn(
                'relative flex h-full flex-col p-5 transition-colors duration-300',
                isCurrent ? 'bg-bg-2' : 'bg-bg',
              )}
              style={
                isCurrent
                  ? { background: 'linear-gradient(180deg, rgb(var(--accent) / 0.06), rgb(var(--bg-2)))' }
                  : undefined
              }
            >
              {isCurrent && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 top-0 h-px"
                  style={{ background: 'linear-gradient(90deg, transparent, rgb(var(--accent)), transparent)' }}
                />
              )}
              <div className="flex items-baseline justify-between">
                <span
                  className={cn(
                    'font-mono text-[11px] uppercase tracking-[0.22em]',
                    isCurrent ? 'text-accent' : 'text-fg-mute',
                  )}
                >
                  {String(s.n).padStart(2, '0')}
                </span>
                <span
                  className={cn(
                    'font-mono text-[9px] uppercase tracking-[0.22em]',
                    isCurrent && 'text-accent',
                    isNext && 'text-accent-2',
                    !isCurrent && !isNext && 'text-fg-mute',
                  )}
                >
                  {statusBadge[s.status]}
                </span>
              </div>
              <h3
                className={cn(
                  'mt-5 text-[15px] font-medium leading-tight',
                  isCurrent ? 'text-fg' : 'text-fg-dim',
                )}
              >
                {s.title}
              </h3>
              <p className="mt-2.5 text-[13px] leading-relaxed text-fg-mute">{s.desc}</p>
              {isCurrent && (
                <div className="mt-auto pt-5">
                  <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-accent">
                    <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full" style={{ background: 'rgb(var(--accent))' }} />
                    Active
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
