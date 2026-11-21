/**
 * Watching <html data-theme> while the document is parsed (ARCHITECTURE.md 15, item 3: the theme
 * persists without a flash). The pages are static, so the server always sends the content's
 * default theme; the inline head script (lib/theme.ts themeScript) reads the visitor's cookie and
 * sets data-theme before the body is parsed, so nothing is ever painted in the other theme.
 */
import type { Page } from '@playwright/test';

export interface ThemeLog {
  /** data-theme as the server sent it (before the first change), if it changed at all. */
  server: string | null;
  /** data-theme at the moment the parser added <body>: before anything in the body exists or paints. */
  atBody: string | null;
  /** Every change of data-theme on <html>, in order, and whether <body> existed then. */
  changes: { from: string | null; to: string | null; afterBody: boolean }[];
  /** data-theme in each animation frame while the page loaded, once <body> existed (before each paint). */
  frames: (string | null)[];
}

/**
 * Installed with page.addInitScript, so it runs when the document is created, before the parser
 * has added <html> and before any of the page's scripts. A MutationObserver on the document keeps
 * every change of data-theme on <html> and the value at the moment <body> was added (rebuilt from
 * the records' old values, so a batch of records delivered later still gives the value at each
 * step), and a requestAnimationFrame chain notes the value in every frame until the load event.
 */
export function recordTheme(): void {
  const log: ThemeLog = { server: null, atBody: null, changes: [], frames: [] };
  let bodySeen = false;
  const read = () => document.documentElement?.getAttribute('data-theme') ?? null;
  const observer = new MutationObserver((records) => {
    const now = read();
    const onHtml = (record: MutationRecord) => record.type === 'attributes' && record.target === document.documentElement;
    // The value right after record `index`: the old value of the next change, or the value now.
    const valueAfter = (index: number) => {
      for (let next = index + 1; next < records.length; next += 1) if (onHtml(records[next])) return records[next].oldValue;
      return now;
    };
    records.forEach((record, index) => {
      if (onHtml(record)) {
        if (log.changes.length === 0) log.server = record.oldValue;
        log.changes.push({ from: record.oldValue, to: valueAfter(index), afterBody: bodySeen });
      } else if (record.type === 'childList' && !bodySeen) {
        for (const node of Array.from(record.addedNodes)) {
          if (node.nodeName === 'BODY') {
            bodySeen = true;
            log.atBody = valueAfter(index);
          }
        }
      }
    });
  });
  observer.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-theme'], attributeOldValue: true });
  const frame = () => {
    if (document.body) log.frames.push(read());
    if (document.readyState !== 'complete') requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  (window as unknown as { __e2eTheme: ThemeLog }).__e2eTheme = log;
}

/** What recordTheme saw on the page now in the window. */
export function themeLog(page: Page): Promise<ThemeLog> {
  return page.evaluate(() => (window as unknown as { __e2eTheme: ThemeLog }).__e2eTheme);
}

/** Problems with a log, for a visitor whose cookie says `theme`: empty when there was no flash. */
export function flashes(log: ThemeLog, theme: string): string[] {
  const problems: string[] = [];
  if (log.atBody !== theme) problems.push(`data-theme was "${log.atBody}" when the body began (the server sent "${log.server ?? log.atBody}")`);
  const later = log.changes.filter((change) => change.afterBody && change.to !== change.from);
  for (const change of later) problems.push(`data-theme changed from "${change.from}" to "${change.to}" after the body began`);
  const wrong = log.frames.filter((value) => value !== theme);
  if (wrong.length > 0) problems.push(`${wrong.length} of ${log.frames.length} frames during the load showed "${wrong[0]}"`);
  if (log.frames.length === 0 && log.atBody === null) problems.push('the recorder saw neither the body nor a frame');
  return problems;
}
