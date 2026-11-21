import type { CSSProperties } from 'react';
import { hasText } from '@/lib/format';
import type { Callout } from '@/lib/types';

/**
 * Shared by DimensionCallouts (server) and DimensionFigure (client): the callouts that may be
 * drawn, the edge slots they are drawn in, and the row of readouts under a cover.
 */

/** A project's callouts that can be shown: label and value both present, at most three. */
export function shownCallouts(callouts: Callout[] | undefined): Callout[] {
  return (callouts ?? []).filter((c) => hasText(c.label) && hasText(c.value)).slice(0, 3);
}

type Slot =
  | { kind: 'h'; y: number; x1: number; x2: number; above?: boolean }
  | { kind: 'v'; x: number; y1: number; y2: number };

/**
 * Three edge slots, drawn like the dimensions of a figure (bundle media.jsx): a span along the
 * top, a span down the right side, a span along the bottom with its plate above the line. A slot
 * never points at a feature of the photo: the content gives a number, not a place.
 */
export function slotGeometry(w: number, h: number): Slot[] {
  const edge = (f: number, min: number) => Math.max(min, Math.round(f));
  return [
    { kind: 'h', y: edge(h * 0.13, 30), x1: edge(w * 0.05, 14), x2: w - edge(w * 0.05, 14) },
    { kind: 'v', x: w - edge(w * 0.055, 22), y1: Math.round(h * 0.3), y2: h - edge(h * 0.16, 34) },
    { kind: 'h', y: h - edge(h * 0.09, 22), x1: edge(w * 0.05, 14), x2: Math.round(w * 0.64), above: true },
  ];
}

function arrowH(x: number, y: number, dir: number): string {
  const b = x - dir * 9;
  return `M${x} ${y} L${b} ${y - 4} L${b} ${y + 4} Z`;
}

function arrowV(x: number, y: number, dir: number): string {
  const b = y - dir * 9;
  return `M${x} ${y} L${x - 4} ${b} L${x + 4} ${b} Z`;
}

/** The dimension line, its extension ticks, and its two arrowheads. */
export function slotPaths(s: Slot): { lines: string[]; arrows: string[] } {
  if (s.kind === 'h') {
    return {
      lines: [`M${s.x1} ${s.y} H${s.x2}`, `M${s.x1} ${s.y - 9} V${s.y + 9}`, `M${s.x2} ${s.y - 9} V${s.y + 9}`],
      arrows: [arrowH(s.x1, s.y, -1), arrowH(s.x2, s.y, 1)],
    };
  }
  const mid = Math.round((s.y1 + s.y2) / 2);
  return {
    lines: [
      `M${s.x} ${s.y1} V${s.y2}`,
      `M${s.x - 9} ${s.y1} H${s.x + 9}`,
      `M${s.x - 9} ${s.y2} H${s.x + 9}`,
      `M${s.x - 14} ${mid} H${s.x}`,
    ],
    arrows: [arrowV(s.x, s.y1, -1), arrowV(s.x, s.y2, 1)],
  };
}

/** The least room a plate keeps from the well's sides, in px (the 8 px space step). */
const PLATE_INSET = 8;

/**
 * Where a slot's plate sits: centred on a span along the top or the bottom, or to the left of the
 * span down the side. A plate never runs out of its well, where the well's edge would cut its
 * words: on a narrow card it slides along its line until it fits (a CSS clamp on its own width, so
 * nothing needs measuring), and beside the side span it may cover the line rather than be cut.
 */
export function plateStyle(s: Slot, w: number): CSSProperties {
  if (s.kind === 'h') {
    const centre = Math.round((s.x1 + s.x2) / 2);
    const x = `clamp(${PLATE_INSET - centre}px, -50%, calc(${w - PLATE_INSET - centre}px - 100%))`;
    return {
      left: `${centre}px`,
      top: `${s.y}px`,
      transform: s.above ? `translate(${x}, calc(-100% - 8px))` : `translate(${x}, -50%)`,
    };
  }
  const anchor = s.x - 14;
  return {
    left: `${anchor}px`,
    top: `${Math.round((s.y1 + s.y2) / 2)}px`,
    transform: `translate(max(-100%, ${PLATE_INSET - anchor}px), -50%)`,
  };
}

/**
 * The callouts as a plain row of readouts on glass (bundle .ar-dim__row): under the cover on
 * phones, and at every width when there is no photo to draw over. Use it under a video or model
 * cover too. Renders nothing without callouts.
 */
export function CalloutRow({ callouts, label }: { callouts: Callout[]; label: string }) {
  if (callouts.length === 0) return null;
  return (
    <ul className="ar-dim__row" aria-label={label}>
      {callouts.map((c, i) => (
        <li key={`${c.label}-${i}`}>
          <span className="ar-dim__value">{c.value}</span>
          <span className="ar-dim__label">{c.label}</span>
        </li>
      ))}
    </ul>
  );
}
