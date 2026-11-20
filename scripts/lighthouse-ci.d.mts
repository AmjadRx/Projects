/** Types for scripts/lighthouse-ci.mjs, so the tests can import it under strict TypeScript. */

export type FormFactor = 'mobile' | 'desktop';
export type ThemeName = 'blueprint' | 'whiteprint';

export interface Column {
  key: string;
  label: string;
  budget: string;
  format: (value: number) => string;
  phoneOnly?: boolean;
}

/** One entry of Lighthouse CI's assertion-results.json (the fields this script reads). */
export interface AssertionResult {
  auditId: string;
  auditProperty?: string;
  url: string;
  actual: number;
  values: number[];
  passed: boolean;
  [key: string]: unknown;
}

export interface Cell {
  actual: number;
  values: number[];
  passed: boolean;
}

export interface Row {
  route: string;
  cells: Record<string, Cell | null>;
}

export interface ThemeCheck {
  route: string;
  runs: number;
  matched: number;
  wrong: number;
  unknown: number;
}

/** A Lighthouse result, reduced to what this script reads. */
export interface Lhr {
  requestedUrl: string;
  audits?: Record<string, { details?: { items?: Array<{ url?: string }> } }>;
  [key: string]: unknown;
}

export declare const LHCI_PACKAGE: string;
export declare const COLUMNS: Column[];
export declare function columnsFor(formFactor: FormFactor): Column[];
export declare function parseArgs(argv: string[]): { formFactors: FormFactor[]; themes: ThemeName[] };
export declare function resultKey(result: Pick<AssertionResult, 'auditId' | 'auditProperty'>): string;
export declare function routeOf(url: string): string;
export declare function themeOfRun(lhr: Lhr): ThemeName | 'both' | null;
export declare function themeChecks(lhrs: Lhr[], expected: ThemeName): Map<string, ThemeCheck>;
export declare function assertionRows(results: AssertionResult[], routes: string[], formFactor: FormFactor): Row[];
export declare const RECOLLECT_ATTEMPTS: number;
export declare function incompletePages(urls: string[], runs: number, dir?: string): string[];
export declare function readAndPruneReports(dir: string): Lhr[];
export declare function summaryMarkdown(input: {
  formFactor: FormFactor;
  theme: ThemeName;
  rows: Row[];
  checks: Map<string, ThemeCheck>;
  environment: string;
  lhciStatus: number;
  notes?: string[];
}): { markdown: string; passed: number; total: number };
