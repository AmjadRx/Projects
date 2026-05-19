'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface RevealProps {
  children: ReactNode;
  delay?: number;
  className?: string;
  as?: 'div' | 'section' | 'article' | 'header';
  y?: number;
}

export default function Reveal({
  children,
  delay = 0,
  className,
  as: Tag = 'div',
  y = 18,
}: RevealProps) {
  const ref = useRef<HTMLElement | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setShown(true);
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const style: React.CSSProperties = {
    transitionDelay: shown ? `${delay}ms` : '0ms',
    transform: shown ? 'translateY(0)' : `translateY(${y}px)`,
    opacity: shown ? 1 : 0,
    transitionProperty: 'transform, opacity',
    transitionDuration: '900ms',
    transitionTimingFunction: 'cubic-bezier(0.2, 0.7, 0.2, 1)',
    willChange: shown ? undefined : 'transform, opacity',
  };

  return (
    <Tag ref={ref as React.RefObject<HTMLDivElement>} style={style} className={cn(className)}>
      {children}
    </Tag>
  );
}
