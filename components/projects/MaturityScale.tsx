import { hasText } from '@/lib/format';
import { UI } from '@/lib/strings';

const STEPS = [1, 2, 3, 4, 5] as const;

/**
 * The five-step maturity scale (DESIGN_DIRECTION.md 5.3): filled with the ramp up to the
 * project's step, with the content's own label always printed beside it, so color never carries
 * the meaning alone. Step names are not printed (docs/V3_PLAN.md Q-12 default).
 */
export default function MaturityScale({ maturity }: { maturity?: { step: number; label: string } }) {
  if (!maturity || !hasText(maturity.label)) return null;
  const step = Math.min(5, Math.max(1, Math.round(maturity.step)));
  return (
    <div className="maturity">
      <span className="maturity__steps" aria-hidden>
        {STEPS.map((n) => (
          <span key={n} className="maturity__step" data-n={n} data-filled={n <= step ? 'true' : 'false'} />
        ))}
      </span>
      <span className="text-sm text-ink-dim">
        <span className="sr-only">
          {UI.maturity.label}, {UI.maturity.step(step, STEPS.length)}:{' '}
        </span>
        {maturity.label}
      </span>
    </div>
  );
}
