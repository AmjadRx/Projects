/** Types for scripts/lighthouse-server.mjs, so the tests can import it under strict TypeScript. */
import type { Server } from 'node:http';

export declare function themeCookieHeader(theme: 'blueprint' | 'whiteprint'): string;
export declare function parseServerArgs(argv: string[]): { port: number; cookie: 'blueprint' | 'whiteprint' | null };
export declare function createThemeProxy(options: { upstreamPort: number; cookie: 'blueprint' | 'whiteprint' | null }): Server;
