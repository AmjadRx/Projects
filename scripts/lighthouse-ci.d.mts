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

/** One page of the theme check before collect. */
export interface ProofPage {
  route: string;
  status: number;
  painted: string | null;
  error?: string;
}

/** The theme check before collect: every page it loaded, or why it did not run. */
export type Proof = { ran: true; pages: ProofPage[] } | { ran: false; reason: string };

export interface ThemeVerdict {
  ok: boolean;
  text: string;
}

/** The browser context options of a form factor's screen (Playwright's newContext options). */
export interface ProofScreen {
  viewport: { width: number; height: number };
  deviceScaleFactor: number;
  isMobile: boolean;
  hasTouch: boolean;
}

/** The parts of a Playwright browser the theme check uses (the tests pass a stand-in). */
export interface ProofBrowser {
  newContext(options: ProofScreen): Promise<{
    newPage(): Promise<{
      goto(url: string, options: { waitUntil: 'load'; timeout: number }): Promise<{ status(): number } | null>;
      evaluate<T>(fn: () => T): Promise<T>;
    }>;
    close(): Promise<void>;
  }>;
  close(): Promise<void>;
}

export interface ServerOptions {
  env: Record<string, string | undefined>;
  readyPattern: string;
  timeoutMs: number;
}

export interface ServerHandle {
  stop(): Promise<void>;
}

export declare const LHCI_PACKAGE: string;
export declare const PROOF_SCREENS: Readonly<Record<FormFactor, ProofScreen>>;
export declare function startServer(command: string, options: ServerOptions): Promise<ServerHandle>;
export declare function proveTheme(options: {
  formFactor: FormFactor;
  theme: ThemeName;
  env?: Record<string, string | undefined>;
  start?: (command: string, options: ServerOptions) => Promise<ServerHandle>;
  launch?: () => Promise<ProofBrowser>;
}): Promise<Proof>;
export declare function proofVerdict(page: ProofPage | undefined, expected: ThemeName): 'proven' | 'wrong' | 'unproven';
export declare function proofFailed(proof: Proof, expected: ThemeName): boolean;
export declare function proofLine(proof: Proof, expected: ThemeName): string;
export declare function themeVerdicts(routes: string[], checks: Map<string, ThemeCheck>, proof: Proof, expected: ThemeName): Map<string, ThemeVerdict>;
export declare const COLUMNS: Column[];
export declare function columnsFor(formFactor: FormFactor): Column[];
export declare function parseArgs(argv: string[]): { formFactors: FormFactor[]; themes: ThemeName[] };
export declare function resultKey(result: Pick<AssertionResult, 'auditId' | 'auditProperty'>): string;
export declare function routeOf(url: string): string;
export declare function themeOfRun(lhr: Lhr): ThemeName | 'both' | null;
export declare function themeChecks(lhrs: Lhr[], expected: ThemeName): Map<string, ThemeCheck>;
export declare function assertionRows(results: AssertionResult[], routes: string[], formFactor: FormFactor): Row[];
export declare const RECOLLECT_ATTEMPTS: number;
export declare function collectAgain(urls: string[], lhci: (args: string[]) => number): void;
export declare function environmentLine(lhrs: Lhr[], runs: number): string;
export declare function npxCommand(args: string[], platform?: string): [string, string[], boolean];
export declare function incompletePages(urls: string[], runs: number, dir?: string): string[];
export declare function readAndPruneReports(dir: string): Lhr[];
export declare function summaryMarkdown(input: {
  formFactor: FormFactor;
  theme: ThemeName;
  rows: Row[];
  checks: Map<string, ThemeCheck>;
  proof?: Proof;
  environment: string;
  lhciStatus: number;
  notes?: string[];
}): { markdown: string; passed: number; total: number; themeOk: boolean };
