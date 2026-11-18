import type { CSSProperties } from 'react';
import { hasText } from '@/lib/format';
import { UI } from '@/lib/strings';
import { cn } from '@/lib/utils';

type Step = { label: string; state: 'done' | 'current' | 'todo' };

/**
 * Where a project stands, in a few steps (bundle ProgressStrip, bundle.css 29), from the project's
 * `progress`. Not one of the ramp's eight places, so it is drawn in line only: done is a solid
 * bar, the current step is hatched with "In progress" in the line color, steps to come are
 * phantom (dashed) and say "Planned". The words carry the state (docs/V3_PLAN.md D-69). An ordered
 * list with aria-current="step"; a column per step from 768 px, two columns on phones. Steps with
 * no label are left out, and with none there is no strip.
 */
export default function ProgressStrip({
  steps,
  labelledBy,
  label,
  className,
}: {
  steps: Step[];
  /** The id of the heading that names the strip; or give `label`. */
  labelledBy?: string;
  label?: string;
  className?: string;
}) {
  const shown = steps.filter((step) => hasText(step.label));
  if (shown.length === 0) return null;
  return (
    <ol
      className={cn('ar-prog', className)}
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : label}
      style={{ '--n': shown.length } as CSSProperties}
    >
      {shown.map((step, i) => (
        <li
          key={`${step.label}-${i}`}
          className={cn('ar-prog__step', `is-${step.state}`)}
          aria-current={step.state === 'current' ? 'step' : undefined}
        >
          <span className="ar-prog__bar" aria-hidden="true" />
          <span className="ar-prog__label">{step.label}</span>
          <span className="ar-prog__state">{UI.progressState[step.state]}</span>
        </li>
      ))}
    </ol>
  );
}
