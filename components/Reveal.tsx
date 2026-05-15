'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface RevealProps {
  children: ReactNode;
  delay?: number;
  className?: string;
  as?: 'div' | 'section' | 'article' | 'header';
}

export default function Reveal({ children, delay = 0, className, as: Tag = 'div' }: RevealProps) {
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

  return (
    <Tag
      ref={ref as React.RefObject<HTMLDivElement>}
      style={{ transitionDelay: shown ? `${delay}ms` : '0ms' }}
      className={cn(
        'transition-all duration-700 ease-out will-change-transform',
        shown ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0',
        className,
      )}
    >
      {children}
    </Tag>
  );
}
