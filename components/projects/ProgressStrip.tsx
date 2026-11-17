import { hasText } from '@/lib/format';
import { UI } from '@/lib/strings';

type Step = { label: string; state: 'done' | 'current' | 'todo' };

/**
 * The progress strip: an ordered list whose steps carry their state in words (visually hidden)
 * and in shape, with aria-current on the current step and no ramp colors (docs/V3_PLAN.md D-69).
 */
export default function ProgressStrip({ steps, labelledBy }: { steps: Step[]; labelledBy: string }) {
  const shown = steps.filter((step) => hasText(step.label));
  if (shown.length === 0) return null;
  return (
    <ol aria-labelledby={labelledBy} className="grid gap-px overflow-hidden rounded-sm border border-line bg-[var(--line)] sm:grid-cols-2 lg:grid-cols-4">
      {shown.map((step, i) => (
        <li key={`${step.label}-${i}`} aria-current={step.state === 'current' ? 'step' : undefined} className="flex items-start gap-3 bg-surface p-4">
          <span
            aria-hidden
            className={
              step.state === 'done'
                ? 'mt-1 h-3 w-3 shrink-0 rounded-[1px] bg-ink'
                : step.state === 'current'
                  ? 'mt-1 h-3 w-3 shrink-0 rounded-full border-2 border-accent'
                  : 'mt-1 h-3 w-3 shrink-0 rounded-[1px] border border-ink-mute'
            }
          />
          <span className="flex flex-col">
            <span className="data text-xs text-ink-mute">{i + 1}</span>
            <span className={step.state === 'todo' ? 'text-ink-dim' : 'text-ink'}>{step.label}</span>
            <span className="sr-only">, {UI.progressState[step.state]}</span>
            {step.state === 'current' && (
              <span aria-hidden className="text-xs font-medium text-accent">
                {UI.progressState.current}
              </span>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}
