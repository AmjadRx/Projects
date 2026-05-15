'use client';

import { useRef, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface TiltCardProps {
  children: ReactNode;
  className?: string;
  intensity?: number;
}

export default function TiltCard({ children, className, intensity = 6 }: TiltCardProps) {
  const ref = useRef<HTMLDivElement>(null);

  const onMove = (e: React.MouseEvent) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    el.style.transform = `perspective(1000px) rotateY(${x * intensity}deg) rotateX(${-y * intensity}deg) translateZ(0)`;
    const glowX = (e.clientX - rect.left) / rect.width * 100;
    const glowY = (e.clientY - rect.top) / rect.height * 100;
    el.style.setProperty('--glow-x', `${glowX}%`);
    el.style.setProperty('--glow-y', `${glowY}%`);
  };

  const onLeave = () => {
    const el = ref.current;
    if (!el) return;
    el.style.transform = '';
  };

  return (
    <div
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      style={{
        backgroundImage:
          'radial-gradient(400px circle at var(--glow-x, 50%) var(--glow-y, 50%), rgb(61 224 255 / 0.08), transparent 40%)',
        transformStyle: 'preserve-3d',
        transition: 'transform 200ms ease-out',
      }}
      className={cn('relative will-change-transform', className)}
    >
      {children}
    </div>
  );
}
