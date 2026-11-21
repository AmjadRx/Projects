'use client';

import { useScroll, useTransform } from 'motion/react';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { hero } from '@/lib/motion';
import { useIsoLayoutEffect } from './hooks';
import { perFrame } from './lens';
import { PART, rotorPose, type RotorPose } from './raven';

type Parts = Record<keyof typeof PART, SVGElement[]>;

/** Every element the tilt moves, in both layers and in the stroke-in mask, by its data-hd name. */
function findParts(root: HTMLElement): Parts {
  const parts = {} as Parts;
  for (const key of Object.keys(PART) as (keyof typeof PART)[]) {
    parts[key] = Array.from(root.querySelectorAll<SVGElement>(`[data-hd="${PART[key]}"]`));
  }
  return parts;
}

function setAll(elements: SVGElement[], name: string, value: string): void {
  for (const el of elements) el.setAttribute(name, value);
}

/** Writes a pose into the drawing: transforms and opacities as SVG attributes. */
function applyPose(parts: Parts, pose: RotorPose): void {
  setAll(parts.rotor, 'transform', pose.rotor);
  setAll(parts.disc, 'transform', pose.disc);
  setAll(parts.podFront, 'transform', pose.podFront);
  setAll(parts.podSides, 'transform', pose.podSides);
  setAll(parts.cableLeft, 'transform', pose.cableLeft);
  setAll(parts.cableRight, 'transform', pose.cableRight);
  setAll(parts.blade, 'opacity', String(pose.blades));
  setAll(parts.tail, 'opacity', String(pose.tail));
  setAll(parts.tailHeat, 'opacity', String(pose.tailHeat));
}

/** Puts the rotors back at hover, as the server drew them (reduced motion, paused, unmounted). */
function clearPose(parts: Parts): void {
  for (const key of ['rotor', 'disc', 'podFront', 'podSides', 'cableLeft', 'cableRight'] as const) {
    for (const el of parts[key]) el.removeAttribute('transform');
  }
  for (const key of ['blade', 'tail', 'tailHeat'] as const) {
    for (const el of parts[key]) el.removeAttribute('opacity');
  }
}

/**
 * The scroll-tied rotor tilt (DESIGN_DIRECTION.md 6.1 "Scroll"; motion sheet 4.3; hero.rotor): as
 * the hero scrolls, both wing rotors tilt from hover to cruise and move forward, in the line layer
 * and the thermal layer alike, so the two stay registered; the tail rotor never tilts. The angle
 * is a pure function of the hero's own scroll progress, linear and clamped, with no easing: 0 with
 * the page at rest, 1 when the hero's bottom edge reaches the bottom of the nav.
 *
 * Motion's useScroll tracks the hero with offsets at the hero's own top, which is where the sticky
 * nav ends, and useTransform maps the progress to degrees. Values reach the drawing as SVG
 * attributes through one write per frame, never through React state; a resize re-measures.
 * DrawingStage mounts this only while motion is allowed, and unmounting puts the rotors back at
 * hover.
 */
export default function RotorTilt({ art }: { art: RefObject<HTMLDivElement> }) {
  const section = useRef<HTMLElement | null>(null);
  const [top, setTop] = useState<number | null>(null);

  useIsoLayoutEffect(() => {
    const el = art.current?.closest<HTMLElement>('.hm-hero') ?? null;
    section.current = el;
    if (!el) return;
    // The hero starts where the nav ends (the nav is sticky at its own place), so the hero's top
    // on the page is also the nav's bottom in the window.
    const measure = () => setTop(Math.round(el.getBoundingClientRect().top + window.scrollY));
    measure();
    window.addEventListener('resize', measure, { passive: true });
    return () => window.removeEventListener('resize', measure);
  }, [art]);

  return top === null ? null : <TiltFollower art={art} section={section} top={top} />;
}

function TiltFollower({ art, section, top }: { art: RefObject<HTMLDivElement>; section: RefObject<HTMLElement>; top: number }) {
  const { scrollYProgress } = useScroll({ target: section, offset: [`start ${top}px`, `end ${top}px`] });
  const tilt = useTransform(scrollYProgress, [0, 1], [hero.rotor.hover, hero.rotor.cruise]);

  useEffect(() => {
    const root = art.current;
    if (!root) return;
    const parts = findParts(root);
    const write = () => applyPose(parts, rotorPose(tilt.get()));
    const writer = perFrame(write);
    write();
    const stop = tilt.on('change', writer.request);
    return () => {
      stop();
      writer.cancel();
      clearPose(parts);
    };
  }, [art, tilt]);

  return null;
}
