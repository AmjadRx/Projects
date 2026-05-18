import type { RoadmapStage } from '@/lib/types';
import { cn } from '@/lib/utils';

const statusBadge: Record<RoadmapStage['status'], string> = {
  'in-progress': 'In progress',
  next: 'Next',
  future: 'Future',
};

export default function Roadmap({ stages }: { stages: RoadmapStage[] }) {
  return (
    <div className="scrollbar-thin -mx-6 overflow-x-auto px-6 md:mx-0 md:px-0">
      <div
        className="grid min-w-[1100px] grid-cols-8 gap-px md:min-w-0"
        style={{ background: 'rgb(255 255 255 / 0.08)' }}
      >
        {stages.map((s) => {
          const isCurrent = s.status === 'in-progress';
          const isNext = s.status === 'next';
          return (
            <div
              key={s.n}
              className={cn(
                'flex h-full flex-col bg-navy p-5 transition-colors duration-300',
                isCurrent && 'bg-cyan/5',
              )}
            >
              <div className="flex items-baseline justify-between">
                <span
                  className={cn(
                    'font-mono text-[11px] uppercase tracking-[0.22em]',
                    isCurrent ? 'text-cyan' : 'text-ink-mute',
                  )}
                >
                  {String(s.n).padStart(2, '0')}
                </span>
                <span
                  className={cn(
                    'font-mono text-[9px] uppercase tracking-[0.22em]',
                    isCurrent && 'text-cyan',
                    isNext && 'text-purple',
                    !isCurrent && !isNext && 'text-ink-mute',
                  )}
                >
                  {statusBadge[s.status]}
                </span>
              </div>
              <h3
                className={cn(
                  'mt-4 text-sm font-medium',
                  isCurrent ? 'text-ink' : 'text-ink-dim',
                )}
              >
                {s.title}
              </h3>
              <p className="mt-2 text-xs leading-relaxed text-ink-mute">{s.desc}</p>
              {isCurrent && (
                <div className="mt-auto pt-4">
                  <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.22em] text-cyan">
                    <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-cyan" />
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
