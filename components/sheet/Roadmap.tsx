import type { CSSProperties } from 'react';
import { hasText } from '@/lib/format';
import { UI } from '@/lib/strings';
import { cn } from '@/lib/utils';

export interface RoadmapStage {
  n: number;
  title: string;
  desc: string;
  status: 'done' | 'in-progress' | 'next' | 'future';
}

/**
 * The stages of a roadmap block (bundle Roadmap, bundle.css 16). Stages the content marks done or
 * in progress hold their slice of the ramp in the bar (one of the ramp's eight places); the current
 * stage takes a line border and "In progress" in the line color; planned stages are drawn in
 * phantom line with an empty bar and say "Planned" ("Planned, next" for the next one). The words
 * carry the state. Eight across from 1024 px, four on tablets, a list on phones. Each stage is a
 * glass cell, so it sits on the sky as it is.
 */
export default function Roadmap({
  stages,
  label = UI.roadmap.label,
  className,
}: {
  stages: RoadmapStage[];
  /** The list's accessible name. */
  label?: string;
  className?: string;
}) {
  if (stages.length === 0) return null;
  return (
    <ol className={cn('ar-road', className)} aria-label={label}>
      {stages.map((stage, i) => {
        const hot = stage.status === 'done' || stage.status === 'in-progress';
        return (
          <li
            key={`${stage.n}-${i}`}
            className={cn('ar-road__stage', stage.status === 'in-progress' && 'is-current', stage.status === 'done' && 'is-done')}
            aria-current={stage.status === 'in-progress' ? 'step' : undefined}
          >
            <span className="ar-road__bar" aria-hidden="true">
              {hot ? <span className="ar-road__heat" style={{ '--i': i } as CSSProperties} /> : null}
            </span>
            <span className="ar-road__body">
              <span className="ar-road__n">{UI.roadmap.stage(stage.n)}</span>
              {hasText(stage.title) ? <span className="ar-road__title">{stage.title}</span> : null}
              {hasText(stage.desc) ? <span className="ar-road__desc">{stage.desc}</span> : null}
              <span className="ar-road__status">{UI.roadmapStatus[stage.status]}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
