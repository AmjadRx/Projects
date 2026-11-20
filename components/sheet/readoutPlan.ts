/**
 * What a readout's count-up needs to know about a value (motion sheet 2.3; docs/V3_PLAN.md D-59),
 * shared by the server (components/sheet/Readout.tsx decides which values may count) and the
 * browser (./readoutCount.ts runs the count, ./ReadoutRoll.tsx draws it). No browser code here.
 */
import type { ComponentType } from 'react';
import { load } from '@/lib/motion';

/** The locale the seed writes its numbers in ("1,500", "3.65"). */
export const COUNT_LOCALE = 'en-US';

/** The most digits a value may have and still count: a double holds no more exactly. */
const MAX_DIGITS = 15;

const PLAIN = /^\d+(?:\.\d+)?$/;
const GROUPED = /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/;

/** A value that counts: the number it ends on, and the format that prints it as the seed writes it. */
export interface CountPlan {
  n: number;
  format: {
    minimumIntegerDigits: number;
    minimumFractionDigits: number;
    maximumFractionDigits: number;
    useGrouping: boolean;
  };
}

/**
 * The count for a readout's value, or null for a value that is set as it is. Only a plain number
 * counts ("504", "8", "1,500", "3.65"); a rank ("1st"), a word, a sign or anything else does not.
 * The format keeps every digit the seed writes, leading zeros, decimals and grouping included, and
 * prints 0 at the same width ("000" for "504"); a value it would not print exactly does not count.
 */
export function countPlan(value: string): CountPlan | null {
  const grouped = GROUPED.test(value);
  if (!grouped && !PLAIN.test(value)) return null;
  const [whole, fraction = ''] = value.replace(/,/g, '').split('.');
  if (whole.length + fraction.length > MAX_DIGITS) return null;
  const format = {
    minimumIntegerDigits: whole.length,
    minimumFractionDigits: fraction.length,
    maximumFractionDigits: fraction.length,
    useGrouping: grouped,
  };
  const n = Number(fraction ? `${whole}.${fraction}` : whole);
  try {
    return new Intl.NumberFormat(COUNT_LOCALE, format).format(n) === value ? { n, format } : null;
  } catch {
    return null;
  }
}

/** When the value at `index` in its row starts to count, in seconds after the row: 40 ms apart, in reading order. */
export function countDelay(index: number): number {
  return Math.max(0, index) * load.readouts.step;
}

/** Seconds from the start of a row's count until its value at `lastIndex` has settled. */
export function countLength(lastIndex: number): number {
  return countDelay(lastIndex) + load.readouts.duration;
}

/**
 * - `idle`: as the server drew it, before the row has decided (the server render, hydration).
 * - `wait`: it will count: no digits while AnimateNumber loads or the row comes into view.
 * - `ready`: AnimateNumber is in: the value shows 0.
 * - `run`: counting up.
 * - `done`: the plain value, as the server drew it, for good.
 */
export type CountPhase = 'idle' | 'wait' | 'ready' | 'run' | 'done';

/** What the on-demand leaf (./ReadoutRoll.tsx) takes: it shows 0 until `on`, then the value. */
export interface RollProps {
  plan: CountPlan;
  index: number;
  on: boolean;
}

export type RollComponent = ComponentType<RollProps>;

/** What a value draws: its phase, and AnimateNumber's leaf once it is in. */
export interface CountView {
  phase: CountPhase;
  Roll: RollComponent | null;
}

export const IDLE: CountView = { phase: 'idle', Roll: null };
export const DONE: CountView = { phase: 'done', Roll: null };
