import type { Project } from '@/lib/types';
import { cn } from '@/lib/utils';

const GLYPH = { done: '✓', current: '◉', todo: '○' } as const;

/** Karolina-style progress strip: ✓ Airframe → ◉ Electronics → ○ Flight code */
export default function ProgressStrip({ progress }: { progress: NonNullable<Project['progress']> }) {
  return (
    <ol className="flex flex-wrap items-center gap-y-2 font-mono text-[12px] tracking-wide">
      {progress.steps.map((step, i) => (
        <li key={step.label} className="flex items-center">
          <span
            className={cn(
              'flex items-center gap-1.5',
              step.state === 'current' && 'text-accent',
              step.state === 'done' && 'text-ink-dim',
              step.state === 'todo' && 'text-ink-mute',
            )}
          >
            <span aria-hidden>{GLYPH[step.state]}</span>
            {step.label}
          </span>
          {i < progress.steps.length - 1 && (
            <span className="mx-3 text-ink-mute/50" aria-hidden>→</span>
          )}
        </li>
      ))}
    </ol>
  );
}
