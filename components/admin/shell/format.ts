/** Small wording helpers for the admin's plain sentences. Pure. */
import type { DeployState } from '@/lib/admin/contract';

/** "1 file", "2 files". */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** The first seven characters of a commit, as GitHub shows it. */
export function shortSha(sha: string | null | undefined): string {
  return sha ? sha.slice(0, 7) : '';
}

/** A time of day in the owner's locale ("6:42 PM"). */
export function timeOf(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** A date and time in the owner's locale. */
export function dateTimeOf(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** "4 MB": whole megabytes for limits. */
export function megabytes(bytes: number): string {
  const mb = bytes / 1_000_000;
  return `${mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10} MB`;
}

/** "9:41" for a countdown in seconds. */
export function countdown(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** A deployment's state in words. */
export function deployWords(state: DeployState['state']): string {
  switch (state) {
    case 'queued':
      return 'queued';
    case 'building':
      return 'building';
    case 'ready':
      return 'ready';
    case 'error':
      return 'failed';
    case 'canceled':
      return 'canceled';
    default:
      return 'unknown';
  }
}

/** The badge tone for a deployment's state. */
export function deployTone(state: DeployState['state']): 'ok' | 'warning' | 'error' | 'neutral' {
  if (state === 'ready') return 'ok';
  if (state === 'error' || state === 'canceled') return 'error';
  if (state === 'queued' || state === 'building') return 'warning';
  return 'neutral';
}
