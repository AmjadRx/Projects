/**
 * Where the admin's STEP converter runs (docs/V3_PLAN.md D-81). readStep starts it as a dedicated
 * worker of the admin page itself, one per file and never through a frame: a dedicated worker
 * takes its policy from its own response, so the admin keeps its strict one. The headers from
 * next.config.mjs, matched the way Next's router matches them, let that worker's response alone
 * evaluate strings; no page or other file of the site may.
 */
import fs from 'node:fs';
import path from 'node:path';
import { getPathMatch } from 'next/dist/shared/lib/router/utils/path-match';
import { modifyRouteRegex } from 'next/dist/lib/redirect-status';
import * as THREE from 'three';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { readStep, STEP_PARAMS, STEP_WORKER_URL, type StepResult } from '@/lib/admin/convert/step';
import { createContext, STEP_TIMEOUT_MS } from '@/lib/admin/convert/util';
// @ts-expect-error: a plain .mjs file with no type declarations.
import nextConfig from '../next.config.mjs';

/** A STEP result with one triangle, as the worker sends it. */
function oneTriangle(): StepResult {
  return {
    root: { name: '', meshes: [], children: [{ name: 'box', meshes: [0], children: [] }] },
    meshes: [
      {
        name: 'box',
        color: null,
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        normals: null,
        indices: new Uint32Array([0, 1, 2]),
        faces: [],
      },
    ],
  };
}

// ---------------------------------------------------------------------------------------------
// readStep and its worker
// ---------------------------------------------------------------------------------------------

/** The browser's Worker as the admin page sees it: records each start and answers when told. */
class PageWorker {
  static started: PageWorker[] = [];
  static refuse = false;
  readonly url: string;
  readonly options: unknown;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent | Event) => void) | null = null;
  sent: { message: unknown; transfer: Transferable[] }[] = [];
  terminated = false;
  constructor(url: string | URL, options?: unknown) {
    if (PageWorker.refuse) throw new Error('refused by a policy');
    this.url = String(url);
    this.options = options;
    PageWorker.started.push(this);
  }
  postMessage(message: unknown, transfer: Transferable[]) {
    this.sent.push({ message, transfer });
  }
  terminate() {
    this.terminated = true;
  }
  answer(data: unknown) {
    this.onmessage?.({ data } as MessageEvent);
  }
  fail() {
    this.onerror?.(new Event('error'));
  }
}

/** The admin page: its Worker, and a document that must not be asked for an element (a frame). */
function onAdminPage() {
  PageWorker.started = [];
  PageWorker.refuse = false;
  const createElement = vi.fn((tag: string) => {
    throw new Error(`the admin adds no ${tag} to read a STEP file`);
  });
  vi.stubGlobal('Worker', PageWorker);
  vi.stubGlobal('document', { createElement, body: { appendChild: vi.fn() } });
  return { createElement };
}

const read = (name: string, signal?: AbortSignal) => readStep(new File([new Uint8Array(32)], name), THREE, createContext(name, { signal }));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('readStep', () => {
  it('reads the file in a worker the admin page starts itself, at the worker address, with no frame', async () => {
    const { createElement } = onAdminPage();
    const pending = read('box.step');
    await vi.waitFor(() => expect(PageWorker.started[0]?.sent).toHaveLength(1));
    const [worker] = PageWorker.started;
    expect(worker.url).toBe('/admin-workers/occt-worker.js');
    expect(worker.url).toBe(STEP_WORKER_URL);
    // A classic worker: occt-worker.js loads the kernel with importScripts.
    expect(worker.options).toBeUndefined();
    const { message, transfer } = worker.sent[0];
    expect(message).toMatchObject({ params: STEP_PARAMS });
    expect(transfer).toEqual([(message as { bytes: ArrayBuffer }).bytes]);

    worker.answer({ ok: true, ...oneTriangle() });
    const scene = await pending;
    expect(scene.children.map((child) => child.name)).toEqual(['box']);
    expect(worker.terminated).toBe(true);
    expect(PageWorker.started).toHaveLength(1);
    expect(createElement).not.toHaveBeenCalled();
  });

  it('gives every file a worker of its own, so a file that fails or is cancelled holds up no other', async () => {
    onAdminPage();
    const first = read('a.step').catch((error: unknown) => error);
    await vi.waitFor(() => expect(PageWorker.started).toHaveLength(1));
    const second = read('b.step');
    await vi.waitFor(() => expect(PageWorker.started).toHaveLength(2));
    const [stuck, other] = PageWorker.started;
    expect(other).not.toBe(stuck);
    other.answer({ ok: true, ...oneTriangle() });
    await expect(second).resolves.toBeDefined();
    expect(stuck.terminated).toBe(false);

    // A worker that fails ends its own file at once, as blocked.
    stuck.fail();
    expect(await first).toMatchObject({ name: 'PrepareError', code: 'step-blocked' });
    expect(stuck.terminated).toBe(true);

    // Cancelling a file ends its worker.
    const controller = new AbortController();
    const cancelled = read('c.step', controller.signal);
    await vi.waitFor(() => expect(PageWorker.started).toHaveLength(3));
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
    expect(PageWorker.started[2].terminated).toBe(true);

    // A worker the browser refuses to start fails only its own file; the next file starts a new one.
    PageWorker.refuse = true;
    await expect(read('d.step')).rejects.toMatchObject({ name: 'PrepareError', code: 'step-blocked' });
    PageWorker.refuse = false;
    const next = read('e.step');
    await vi.waitFor(() => expect(PageWorker.started).toHaveLength(4));
    PageWorker.started[3].answer({ ok: true, ...oneTriangle() });
    await expect(next).resolves.toBeDefined();
  });

  it('ends a file whose worker never answers at the time limit, and starts the next file afresh', async () => {
    vi.useFakeTimers();
    onAdminPage();
    const first = read('a.step').catch((error: unknown) => error);
    await vi.waitFor(() => expect(PageWorker.started).toHaveLength(1));
    const [silent] = PageWorker.started;
    await vi.advanceTimersByTimeAsync(STEP_TIMEOUT_MS - 1000);
    expect(silent.terminated).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await first).toMatchObject({ name: 'PrepareError', code: 'step-timeout' });
    expect(silent.terminated).toBe(true);

    const next = read('b.step');
    await vi.waitFor(() => expect(PageWorker.started).toHaveLength(2));
    PageWorker.started[1].answer({ ok: true, ...oneTriangle() });
    await expect(next).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------------------------
// The headers (next.config.mjs)
// ---------------------------------------------------------------------------------------------

interface HeaderRule {
  source: string;
  headers: { key: string; value: string }[];
}

let rules: HeaderRule[] = [];

beforeAll(async () => {
  rules = await (nextConfig as { headers: () => Promise<HeaderRule[]> }).headers();
});

/** Whether a rule applies to a path, matched as Next's router matches header rules. */
function applies(rule: HeaderRule, pathname: string): boolean {
  const match = getPathMatch(rule.source, { strict: true, removeUnnamedParams: true, regexModifier: (regex) => modifyRouteRegex(regex) });
  return match(pathname) !== false;
}

/** The headers sent for a path: every rule that applies, in order, a later value replacing an earlier one. */
function headersFor(pathname: string): Map<string, string> {
  const sent = new Map<string, string>();
  for (const rule of rules) {
    if (applies(rule, pathname)) for (const { key, value } of rule.headers) sent.set(key.toLowerCase(), value);
  }
  return sent;
}

/** Every policy the rules set on a path, each once. More than one would be enforced together where a host merges them. */
function policiesFor(pathname: string): string[] {
  const found = new Set<string>();
  for (const rule of rules) {
    if (!applies(rule, pathname)) continue;
    for (const { key, value } of rule.headers) if (key.toLowerCase() === 'content-security-policy') found.add(value);
  }
  return [...found];
}

/** A policy's directives, each with its values. */
function directives(policy: string | undefined): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const part of (policy ?? '').split(';')) {
    const [name, ...values] = part.trim().split(/\s+/);
    if (name && !found.has(name)) found.set(name, values);
  }
  return found;
}

/**
 * Whether a document served with this policy may evaluate strings in the site's origin: no
 * script-src (nor default-src) lets it, as 'unsafe-eval' does; a sandbox without
 * allow-same-origin puts it in an origin of its own.
 */
function evaluatesInOrigin(policy: string | undefined): boolean {
  const list = directives(policy);
  const sandbox = list.get('sandbox');
  if (sandbox && !sandbox.includes('allow-same-origin')) return false;
  const scripts = list.get('script-src') ?? list.get('default-src');
  return scripts === undefined || scripts.includes("'unsafe-eval'");
}

/** Every file in public/, as the path it is served at. */
function publicPaths(dir = path.join(process.cwd(), 'public'), prefix = ''): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => (entry.isDirectory() ? publicPaths(path.join(dir, entry.name), `${prefix}/${entry.name}`) : [`${prefix}/${entry.name}`]));
}

describe('the headers for the STEP worker', () => {
  it('serves the worker alone with a policy that lets the kernel evaluate strings, and never in a frame', () => {
    expect(fs.existsSync(path.join(process.cwd(), 'public', STEP_WORKER_URL))).toBe(true);
    const sent = headersFor(STEP_WORKER_URL);
    const policy = sent.get('content-security-policy');
    expect(policiesFor(STEP_WORKER_URL)).toEqual([policy]);
    expect(directives(policy).get('script-src')).toEqual(expect.arrayContaining(["'self'", "'unsafe-eval'", "'wasm-unsafe-eval'"]));
    expect(directives(policy).get('connect-src')).toEqual(["'self'"]);
    expect(sent.get('x-frame-options')).toBe('DENY');
  });

  it('keeps the admin strict, while it may start a worker from its own origin', () => {
    for (const pathname of ['/admin', '/admin/projects']) {
      const policy = headersFor(pathname).get('content-security-policy');
      expect(policiesFor(pathname)).toEqual([policy]);
      expect(evaluatesInOrigin(policy)).toBe(false);
      expect(directives(policy).get('worker-src')).toContain("'self'");
    }
  });

  it('lets no page or other file of the site evaluate strings in its origin', () => {
    const paths = [
      ...publicPaths(),
      '/',
      '/admin',
      '/admin/projects',
      '/projects/raven',
      // Any other page or script beside the worker, such as the frame host this replaced.
      '/admin-workers/step-host.html',
      '/admin-workers/step-host.js',
      '/admin-workers/other.html',
    ];
    expect(paths).toContain(STEP_WORKER_URL);
    expect(paths.filter((pathname) => evaluatesInOrigin(headersFor(pathname).get('content-security-policy')))).toEqual([STEP_WORKER_URL]);

    const strict = headersFor('/').get('content-security-policy');
    expect(evaluatesInOrigin(strict)).toBe(false);
    for (const pathname of ['/admin-workers/step-host.html', '/admin-workers/step-host.js', '/admin-workers/other.html', '/admin-workers/occt-worker.js.map']) {
      const sent = headersFor(pathname);
      expect(sent.get('content-security-policy')).toBe(strict);
      expect(sent.get('x-frame-options')).toBe('DENY');
    }
  });
});
