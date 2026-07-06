'use client';

import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';

/** Count-up for values like "3.7", "504", "140", "1st", "2nd". */
export default function CountUp({ value, duration = 600 }: { value: string; duration?: number }) {
  const reduced = useReducedMotion();
  const m = value.match(/^(\d+(?:\.\d+)?)(.*)$/);
  const target = m ? parseFloat(m[1]) : null;
  const rest = m ? m[2] : '';
  const decimals = m && m[1].includes('.') ? m[1].split('.')[1].length : 0;

  const ref = useRef<HTMLSpanElement>(null);
  const started = useRef(false);
  const [display, setDisplay] = useState(target === null || reduced ? value : `0${rest}`);

  useEffect(() => {
    if (target === null || reduced) {
      setDisplay(value);
      return;
    }
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setDisplay(value);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting) || started.current) return;
        started.current = true;
        const t0 = performance.now();
        const tick = (now: number) => {
          const p = Math.min(1, (now - t0) / duration);
          const eased = 1 - Math.pow(1 - p, 3);
          setDisplay(`${(target * eased).toFixed(decimals)}${rest}`);
          if (p < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        io.disconnect();
      },
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [value, target, rest, decimals, duration, reduced]);

  return <span ref={ref}>{display}</span>;
}
