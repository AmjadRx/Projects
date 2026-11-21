/**
 * The merged build log for /log: every `log` block entry from every visible project, nested
 * columns included, in project order. RevisionTable sorts them newest first (docs/V3_PLAN.md D-12).
 */
import { dateSortKey } from './format';
import { isKnownBlock } from './schema';
import type { Block, MediaRef, Project } from './types';

export interface LogEntry {
  project: Project;
  blockId: string;
  index: number;
  date: string;
  title: string;
  md: string;
  media: MediaRef[];
}

function collect(blocks: Block[], project: Project, out: LogEntry[]): void {
  for (const block of blocks) {
    if (!isKnownBlock(block)) continue;
    if (block.type === 'log') {
      block.entries.forEach((entry, index) => {
        out.push({ project, blockId: block.id, index, date: entry.date, title: entry.title, md: entry.md, media: entry.media ?? [] });
      });
    } else if (block.type === 'twoCol') {
      collect(block.left, project, out);
      collect(block.right, project, out);
    }
  }
}

/** Log entries of the given (visible) projects, in project order, then block and entry order. */
export function mergedLog(projects: Project[]): LogEntry[] {
  const out: LogEntry[] = [];
  for (const project of projects) collect(project.blocks, project, out);
  return out;
}

/**
 * Sorts newest first by the date prefix, whatever its precision ("2026-08-13", "2026-07").
 * Entries with the same date keep their incoming order, which on /log is project order
 * (docs/V3_PLAN.md D-12).
 */
export function newestFirst<T extends { date: string }>(rows: T[]): T[] {
  return rows
    .map((row, index) => ({ row, index, key: dateSortKey(row.date) }))
    .sort((a, b) => (a.key === b.key ? a.index - b.index : a.key < b.key ? 1 : -1))
    .map(({ row }) => row);
}
