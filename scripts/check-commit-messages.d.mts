/** Types for scripts/check-commit-messages.mjs, so the tests can import it under strict TypeScript. */

export interface Commit {
  sha: string;
  message: string;
}

export declare const DASHES: RegExp;
export declare const LOG_FORMAT: string;
export declare function parseLog(text: string): Commit[];
export declare function commitsWithDashes(commits: Commit[]): string[];
export declare function messageText(file: string): string;
