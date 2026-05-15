'use client';

import { useEffect, useRef, useState } from 'react';

function parseNumber(value: string): { num: number | null; prefix: string; suffix: string } {
  const m = value.match(/^([^\d-]*)(-?\d+(?:\.\d+)?)(.*)$/);
  if (!m) return { num: null, prefix: value, suffix: '' };
  return { num: parseFloat(m[2]), prefix: m[1], suffix: m[3] };
}

export default function AnimatedNumber({ value, duration = 1200 }: { value: string; duration?: number }) {
  const { num, prefix, suffix } = parseNumber(value);
  const [display, setDisplay] = useState(num === null ? value : `${prefix}0${suffix}`);
  const ref = useRef<HTMLSpanElement | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (num === null) {
      setDisplay(value);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const start = () => {
      if (started.current) return;
      started.current = true;
      const t0 = performance.now();
      const decimals = (num.toString().split('.')[1] ?? '').length;
      const tick = (now: number) => {
        const p = Math.min(1, (now - t0) / duration);
        const eased = 1 - Math.pow(1 - p, 3);
        const v = num * eased;
        const formatted = decimals > 0 ? v.toFixed(decimals) : Math.round(v).toString();
        setDisplay(`${prefix}${formatted}${suffix}`);
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };

    if (typeof IntersectionObserver === 'undefined') {
      start();
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            start();
            io.disconnect();
          }
        });
      },
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [value, duration, num, prefix, suffix]);

  return <span ref={ref}>{display}</span>;
}
