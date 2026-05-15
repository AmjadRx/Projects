import type { RoadmapStage } from '@/lib/types';
import { cn } from '@/lib/utils';

const statusBadge: Record<RoadmapStage['status'], string> = {
  'in-progress': 'IN PROGRESS',
  next: 'NEXT',
  future: 'FUTURE',
};

export default function Roadmap({ stages }: { stages: RoadmapStage[] }) {
  return (
    <div className="scrollbar-thin -mx-6 overflow-x-auto px-6 md:mx-0 md:px-0">
      <div className="grid min-w-[1100px] grid-cols-8 gap-3 md:min-w-0">
        {stages.map((s) => {
          const isCurrent = s.status === 'in-progress';
          const isNext = s.status === 'next';
          return (
            <div
              key={s.n}
              className={cn(
                'flex h-full flex-col rounded-xl border bg-navy-2/60 p-4 transition-colors',
                isCurrent && 'border-cyan bg-cyan/5 shadow-glow',
                isNext && 'border-purple/40 bg-purple/5',
                !isCurrent && !isNext && 'border-white/8',
              )}
              style={!isCurrent && !isNext ? { borderColor: 'rgb(255 255 255 / 0.08)' } : undefined}
            >
              <div className="flex items-center justify-between">
                <span
                  className={cn(
                    'font-mono text-[10px] uppercase tracking-widest',
                    isCurrent ? 'text-cyan' : isNext ? 'text-purple' : 'text-ink-mute',
                  )}
                >
                  Stage {String(s.n).padStart(2, '0')}
                </span>
                <span
                  className={cn(
                    'rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest',
                    isCurrent && 'bg-cyan/20 text-cyan',
                    isNext && 'bg-purple/20 text-purple',
                    !isCurrent && !isNext && 'bg-white/5 text-ink-mute',
                  )}
                >
                  {statusBadge[s.status]}
                </span>
              </div>
              <h3 className="mt-3 text-sm font-semibold text-ink">{s.title}</h3>
              <p className="mt-1 text-xs leading-relaxed text-ink-dim">{s.desc}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
