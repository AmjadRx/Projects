'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { useReducedMotion } from 'framer-motion';

interface Star {
  x: number;
  y: number;
  r: number;
  phase: number;
  speed: number;
  drift: number;
}

interface Spark {
  points: { x: number; y: number }[];
  born: number;
  life: number;
}

const STAR_COUNT = 130;

/**
 * Site-wide ambient background: slow-drifting, twinkling starfield with
 * occasional faint electrical arcs (dark theme only). Canvas 2D, paused when
 * the tab is hidden, disabled entirely under prefers-reduced-motion and in /admin.
 */
export default function BackgroundFX() {
  const pathname = usePathname();
  const reduced = useReducedMotion();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isAdmin = pathname?.startsWith('/admin');

  useEffect(() => {
    if (reduced || isAdmin) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = 0;
    let height = 0;
    let dpr = 1;
    let raf = 0;
    let running = true;
    let dark = document.documentElement.dataset.theme !== 'light';

    const stars: Star[] = Array.from({ length: STAR_COUNT }, () => ({
      x: Math.random(),
      y: Math.random(),
      r: 0.4 + Math.random() * 1.1,
      phase: Math.random() * Math.PI * 2,
      speed: 0.3 + Math.random() * 0.9,
      drift: 0.002 + Math.random() * 0.006,
    }));
    let sparks: Spark[] = [];
    let nextSparkAt = performance.now() + 3000 + Math.random() * 5000;

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const themeObserver = new MutationObserver(() => {
      dark = document.documentElement.dataset.theme !== 'light';
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    const onVisibility = () => {
      running = !document.hidden;
      if (running) {
        raf = requestAnimationFrame(tick);
      } else {
        cancelAnimationFrame(raf);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    const spawnSpark = () => {
      const startX = Math.random() * width;
      const startY = Math.random() * height * 0.7;
      const segments = 4 + Math.floor(Math.random() * 3);
      const points = [{ x: startX, y: startY }];
      let angle = Math.random() * Math.PI * 2;
      for (let i = 0; i < segments; i++) {
        angle += (Math.random() - 0.5) * 1.4;
        const len = 14 + Math.random() * 30;
        const last = points[points.length - 1];
        points.push({ x: last.x + Math.cos(angle) * len, y: last.y + Math.sin(angle) * len });
      }
      sparks.push({ points, born: performance.now(), life: 420 + Math.random() * 280 });
    };

    const tick = (now: number) => {
      if (!running) return;
      ctx.clearRect(0, 0, width, height);
      const t = now / 1000;

      // stars
      for (const star of stars) {
        star.x += star.drift / 100;
        if (star.x > 1.02) star.x = -0.02;
        const twinkle = 0.55 + 0.45 * Math.sin(star.phase + t * star.speed);
        const alpha = (dark ? 0.5 : 0.22) * twinkle;
        ctx.beginPath();
        ctx.arc(star.x * width, star.y * height, star.r, 0, Math.PI * 2);
        ctx.fillStyle = dark
          ? `rgba(179, 188, 200, ${alpha})`
          : `rgba(75, 85, 99, ${alpha})`;
        ctx.fill();
        // a few accent-tinted stars
        if (star.r > 1.3) {
          ctx.beginPath();
          ctx.arc(star.x * width, star.y * height, star.r * 2.4, 0, Math.PI * 2);
          ctx.fillStyle = dark
            ? `rgba(88, 166, 255, ${alpha * 0.12})`
            : `rgba(29, 78, 216, ${alpha * 0.1})`;
          ctx.fill();
        }
      }

      // electrical arcs (dark theme only, sparse and faint)
      if (dark) {
        if (now > nextSparkAt) {
          spawnSpark();
          nextSparkAt = now + 4000 + Math.random() * 7000;
        }
        sparks = sparks.filter((spark) => now - spark.born < spark.life);
        for (const spark of sparks) {
          const progress = (now - spark.born) / spark.life;
          const alpha = 0.3 * Math.sin(progress * Math.PI);
          ctx.beginPath();
          ctx.moveTo(spark.points[0].x, spark.points[0].y);
          for (const point of spark.points.slice(1)) ctx.lineTo(point.x, point.y);
          ctx.strokeStyle = `rgba(88, 166, 255, ${alpha})`;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
      themeObserver.disconnect();
    };
  }, [reduced, isAdmin]);

  if (reduced || isAdmin) return null;

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10"
    />
  );
}
