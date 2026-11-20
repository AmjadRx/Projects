/**
 * Readies next/og's renderer before the first image of a process is drawn.
 *
 * next/og (Next 14.2) loads its renderer, the @vercel/og 0.6.3 Node build, on first use. That
 * module finds its own files with `path.join(import.meta.url, "../file")`, and on Windows, under
 * Node versions that put "./" before a first path segment holding a colon (Node 20.19.4, 22.17.1,
 * 24.4.1 and later), the joined "file:" address is no longer a URL, so the module fails to load
 * and every image, the site icon included, fails in `next dev` and `next build`. Linux, where the
 * site is built and served, is not affected.
 *
 * On Windows only, this loads the module once with `path.join` answering a "file:" first argument
 * as a file address, then puts the original `path.join` back; next/og then finds the loaded module
 * in Node's module cache. Every other call to `path.join` is passed through unchanged. Remove this
 * file when next/og's renderer no longer joins a URL as a path (check after Phase 1's upgrade).
 */
import 'server-only';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

let ready: Promise<void> | null = null;

async function load(): Promise<void> {
  if (process.platform !== 'win32') return;
  const original = path.join;
  path.join = function join(first: string, ...rest: string[]): string {
    if (typeof first === 'string' && first.startsWith('file:')) return pathToFileURL(original(fileURLToPath(first), ...rest)).href;
    return original(first, ...rest);
  };
  syncBuiltinESMExports();
  try {
    await import('next/dist/compiled/@vercel/og/index.node.js');
  } finally {
    path.join = original;
    syncBuiltinESMExports();
  }
}

/** Resolves once next/og can draw in this process. Call it before creating an ImageResponse. */
export function ogReady(): Promise<void> {
  ready ??= load();
  return ready;
}
