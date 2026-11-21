import type { CSSProperties } from 'react';
import { hasText } from '@/lib/format';
import { UI } from '@/lib/strings';
import { cn } from '@/lib/utils';

const STEPS = [1, 2, 3, 4, 5] as const;

/**
 * The five-step maturity scale (bundle MaturityScale, bundle.css 12): cells filled with their slice
 * of the thermal ramp up to the project's step inside a solid outline, the steps not reached drawn
 * in phantom line (dashed), and the content's own label always printed, so color never carries the
 * state alone. One of the ramp's eight places.
 *
 * - full: 14 px cells and the label under them (project pages, the title block, featured cards).
 * - compact: 10 px cells and the label as one line (regular cards).
 *
 * The step names (Concept to Fielded) are not printed: docs/V3_PLAN.md Q-12 keeps the content's
 * label alone until the owner answers. With no label there is no scale at all.
 */
export default function MaturityScale({
  maturity,
  variant = 'full',
  className,
}: {
  maturity?: { step: number; label: string } | null;
  variant?: 'full' | 'compact';
  className?: string;
}) {
  if (!maturity || !hasText(maturity.label)) return null;
  const step = Math.min(5, Math.max(1, Math.round(maturity.step)));
  return (
    <div className={cn('ar-ms', `ar-ms--${variant}`, className)}>
      <p className="ar-sr">
        {UI.maturity.label}, {UI.maturity.step(step, STEPS.length)}: {maturity.label}
      </p>
      <ol className="ar-ms__cells" aria-hidden="true">
        {STEPS.map((n) => {
          const filled = n <= step;
          return (
            <li key={n} className={cn('ar-ms__cell', filled ? 'is-filled' : 'is-empty', n === step && 'is-current')}>
              <span className="ar-ms__box">
                {filled ? <span className="ar-ms__heat" style={{ '--i': n - 1 } as CSSProperties} /> : null}
              </span>
            </li>
          );
        })}
      </ol>
      <p className={variant === 'full' ? 'ar-ms__label' : 'ar-ms__caption'} aria-hidden="true">
        {maturity.label}
      </p>
    </div>
  );
}
