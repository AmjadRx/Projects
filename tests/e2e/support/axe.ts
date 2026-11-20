/**
 * axe-core in the page (ARCHITECTURE.md 10: "Tested with axe in Playwright on every route in both
 * themes"). The script is injected from node_modules with page.addScriptTag; the site's policy
 * allows inline scripts, so nothing about the page is changed to run it. It runs every rule tagged
 * for WCAG 2.0, 2.1 and 2.2 at levels A and AA (axe has no rule tagged for 2.2 at level A, so that
 * tag is used if a later axe adds one), and reports violations only.
 */
import type { Page } from '@playwright/test';

/** The tags of WCAG 2.0, 2.1 and 2.2, levels A and AA, that axe-core 4.11 uses. */
export const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const AXE_SCRIPT = require.resolve('axe-core/axe.min.js');

export interface AxeViolation {
  rule: string;
  impact: string;
  help: string;
  /** Each failing node's selector, with the first line of axe's summary for it. */
  nodes: { target: string; summary: string }[];
}

export interface AxeReport {
  version: string;
  /** The tags the run used (every WCAG A and AA tag axe knows, from WCAG_TAGS on). */
  tags: string[];
  violations: AxeViolation[];
}

/** Runs axe on the whole document as it is now. */
export async function runAxe(page: Page): Promise<AxeReport> {
  if (!(await page.evaluate(() => 'axe' in window))) await page.addScriptTag({ path: AXE_SCRIPT });
  return page.evaluate(async () => {
    const axe = (window as unknown as { axe: typeof import('axe-core') }).axe;
    const tags = Array.from(new Set(axe.getRules().flatMap((rule) => rule.tags)))
      .filter((tag) => /^wcag2[12]?a{1,2}$/.test(tag))
      .sort();
    const results = await axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] });
    return {
      version: axe.version,
      tags,
      violations: results.violations.map((violation) => ({
        rule: violation.id,
        impact: violation.impact ?? 'unknown',
        help: violation.help,
        nodes: violation.nodes.map((node) => ({
          target: node.target.map((part) => (Array.isArray(part) ? part.join(' >>> ') : String(part))).join(' '),
          summary: (node.failureSummary ?? '').split('\n').map((line) => line.trim()).filter(Boolean).slice(1, 2).join(' '),
        })),
      })),
    };
  });
}

/** The violations as lines for a failure message: rule, impact, help, then each target. */
export function describeViolations(violations: AxeViolation[]): string {
  if (violations.length === 0) return 'no violations';
  const lines = [`${violations.length} axe violation(s):`];
  for (const violation of violations) {
    lines.push(`- ${violation.rule} (${violation.impact}): ${violation.help}`);
    for (const node of violation.nodes.slice(0, 8)) lines.push(`    at ${node.target}${node.summary ? `: ${node.summary}` : ''}`);
    if (violation.nodes.length > 8) lines.push(`    and ${violation.nodes.length - 8} more`);
  }
  return lines.join('\n');
}
