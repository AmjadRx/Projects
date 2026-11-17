import { UI } from '@/lib/strings';
/**
 * Time helpers shared by the video and audio players: the clock in the toolbar and the words a
 * screen reader hears on the seek control.
 */

function wholeSeconds(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/** Seconds as a clock: "0:05", "12:40", "1:02:03". Unknown or negative values read "0:00". */
export function formatClock(value: number): string {
  const total = wholeSeconds(value);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

/** Seconds in words, for assistive technology: "1 minute 5 seconds". */
export function formatSpoken(value: number): string {
  const total = wholeSeconds(value);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const parts: string[] = [];
  if (hours) parts.push(UI.viewers.time.hours(hours));
  if (minutes) parts.push(UI.viewers.time.minutes(minutes));
  if (seconds || parts.length === 0) parts.push(UI.viewers.time.seconds(seconds));
  return parts.join(' ');
}

/** The value text of a seek control: "5 seconds of 12 seconds", or the position alone. */
export function seekValueText(current: number, duration: number): string {
  return duration > 0 ? UI.viewers.time.timeOf(formatSpoken(current), formatSpoken(duration)) : formatSpoken(current);
}

/** A media element's duration in seconds when it is known and finite, else 0. */
export function durationOf(media: HTMLMediaElement): number {
  const value = media.duration;
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Seconds that the arrow keys move the playhead. */
export const SEEK_STEP = 5;
