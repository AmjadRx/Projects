'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { hasText } from '@/lib/format';
import { joinReadoutCount } from './readoutCount';
import { countPlan, DONE, IDLE, type CountView } from './readoutPlan';

/** A layout effect in the browser; React warns about one in the server render, which runs neither. */
const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * A readout's value that counts up once (./readoutCount.ts). The server draws the final value: the
 * prefix and suffix at half size, the digits a bare text run between them, so "~50%" reads as one
 * string, with data-count for the start state in app/motion-home.css. In the browser the value
 * joins its row's count before the first paint. While it waits and counts (data-roll) the digits
 * stay where they are, unseen, holding their box and read by screen readers, and AnimateNumber
 * draws over them, hidden from assistive technology. Once the count is over, or when it is not to
 * count, it is the server's markup again.
 */
export default function ReadoutValue({
  prefix,
  value,
  suffix,
  index,
}: {
  prefix?: string;
  value: string;
  suffix?: string;
  /** The readout's place in its row: values count 40 ms apart, in this order. */
  index: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const plan = useMemo(() => countPlan(value), [value]);
  const [view, setView] = useState<CountView>(IDLE);

  useBrowserLayoutEffect(() => {
    const el = ref.current;
    if (!el || !plan) {
      setView(DONE);
      return undefined;
    }
    return joinReadoutCount(el, index, setView);
  }, [index, plan]);

  const { phase, Roll } = view;
  const counting = phase === 'wait' || phase === 'ready' || phase === 'run';
  return (
    <span
      ref={ref}
      className="ar-readout__value readout ar-fluid-readout"
      data-count={phase === 'idle' ? '' : undefined}
      data-roll={counting ? phase : undefined}
    >
      {hasText(prefix) ? <span className="ar-readout__affix">{prefix}</span> : null}
      {counting && plan ? (
        <span className="ar-readout__num">
          {value}
          <span className="ar-readout__roll" aria-hidden="true">
            {Roll && phase !== 'wait' ? <Roll plan={plan} index={index} on={phase === 'run'} /> : null}
          </span>
        </span>
      ) : (
        value
      )}
      {hasText(suffix) ? <span className="ar-readout__affix">{suffix}</span> : null}
    </span>
  );
}
