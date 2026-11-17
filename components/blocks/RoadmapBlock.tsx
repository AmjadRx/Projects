import { hasText } from '@/lib/format';
import { UI } from '@/lib/strings';

type Stage = { n: number; title: string; desc: string; status: 'done' | 'in-progress' | 'next' | 'future' };

/**
 * The roadmap as an ordered list: stages up to the current one are filled, and every stage
 * names its status in words, so color never carries the state alone (docs/V3_PLAN.md D-69).
 */
export default function RoadmapBlock({ stages }: { stages: Stage[] }) {
  if (stages.length === 0) return null;
  return (
    <ol className="grid gap-px overflow-hidden rounded-sm border border-line bg-[var(--line)] sm:grid-cols-2 lg:grid-cols-4">
      {stages.map((stage) => {
        const filled = stage.status === 'done' || stage.status === 'in-progress';
        return (
          <li
            key={stage.n}
            aria-current={stage.status === 'in-progress' ? 'step' : undefined}
            className="flex flex-col gap-2 bg-surface p-4"
          >
            <div className="flex items-center gap-2">
              <span
                aria-hidden
                className="h-2 w-6 rounded-[1px] border border-line"
                style={filled ? { background: stage.status === 'done' ? 'var(--t4)' : 'var(--t5)' } : undefined}
              />
              <span className="data text-xs text-ink-mute">{stage.n}</span>
              <span className="text-xs font-medium text-ink-dim">{UI.roadmapStatus[stage.status]}</span>
            </div>
            {hasText(stage.title) && <p className="font-semibold text-ink">{stage.title}</p>}
            {hasText(stage.desc) && <p className="text-sm text-ink-dim">{stage.desc}</p>}
          </li>
        );
      })}
    </ol>
  );
}
