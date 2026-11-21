#!/usr/bin/env node
/**
 * The server Lighthouse CI measures (collect.startServerCommand in scripts/lighthouse-config.cjs):
 * `next start` on the production build, behind a pass-through proxy on the port Lighthouse loads.
 *
 * Why the proxy: the second theme is a visitor's choice, kept in the `theme` cookie of lib/theme.ts,
 * which the head script reads from document.cookie before the first paint. With --cookie <theme>,
 * every HTML page the proxy passes on also sets that cookie, written as the theme toggle writes it,
 * so the browser holds it before the head script runs and the page shows that theme from its first
 * paint, as for a visitor who chose it. Lighthouse starts every run in a fresh browser; the other
 * ways to give that browser the cookie fail:
 * - Lighthouse's extraHeaders setting only adds a Cookie request header, which never reaches
 *   document.cookie, so every run would show the default theme;
 * - Lighthouse CI's puppeteer script can write the cookie, but then every run shares one browser,
 *   and there Lighthouse 13.6.0 on Chrome 157 lost the page load from its trace (NO_NAVSTART) now and
 *   then, which it never did in a fresh browser.
 * Without --cookie the proxy changes nothing, so both themes are measured through the same path. It
 * adds well under a millisecond a request, under the 150 ms (phone) or 40 ms (desktop) round trip
 * Lighthouse simulates.
 *
 * Usage: node scripts/lighthouse-server.mjs --port <port> [--cookie blueprint|whiteprint]
 * It prints "Ready in" once both servers listen and a page through the proxy carries the cookie it
 * should (Lighthouse CI waits for those words), and stops `next start` when it stops. NEXT_DIST_DIR
 * picks the build, as for `next start`.
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { THEME_COOKIE, THEMES } = createRequire(import.meta.url)('./lighthouse-config.cjs');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The year lib/theme.ts applyTheme keeps the visitor's choice for, in seconds. */
const ONE_YEAR_S = 60 * 60 * 24 * 365;

/** The Set-Cookie value for a theme: the same string lib/theme.ts applyTheme writes to document.cookie. */
export function themeCookieHeader(theme) {
  return `${THEME_COOKIE}=${theme}; Path=/; Max-Age=${ONE_YEAR_S}; SameSite=Lax`;
}

/** --port (required) and --cookie (optional). */
export function parseServerArgs(argv) {
  const value = (flag) => {
    const i = argv.indexOf(flag);
    return i === -1 ? undefined : argv[i + 1];
  };
  const port = Number(value('--port'));
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('--port must be a whole number from 1024 to 65535.');
  const cookie = value('--cookie') ?? null;
  if (cookie !== null && !THEMES.includes(cookie)) throw new Error(`--cookie must be one of: ${THEMES.join(', ')}.`);
  return { port, cookie };
}

/**
 * A proxy to `next start` on upstreamPort that passes every request and response through as they
 * are, adding the theme cookie to HTML responses when `cookie` names a theme.
 */
export function createThemeProxy({ upstreamPort, cookie }) {
  const agent = new http.Agent({ keepAlive: true });
  const server = http.createServer((req, res) => {
    const upstream = http.request(
      { host: '127.0.0.1', port: upstreamPort, method: req.method, path: req.url, headers: req.headers, agent },
      (response) => {
        const headers = { ...response.headers };
        if (cookie && /^text\/html\b/i.test(String(response.headers['content-type'] ?? ''))) {
          headers['set-cookie'] = [...(response.headers['set-cookie'] ?? []), themeCookieHeader(cookie)];
        }
        res.writeHead(response.statusCode ?? 502, response.statusMessage, headers);
        response.pipe(res);
      },
    );
    upstream.on('error', (error) => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(`Lighthouse server: the request to next start failed (${error.code ?? error.message}).`);
    });
    req.pipe(upstream);
  });
  server.on('close', () => agent.destroy());
  return server;
}

/** A port nothing listens on now. */
export function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/** Starts `next start` on `port` and resolves once it says it is ready. */
function startNext(port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next'), 'start', '-p', String(port)], {
      cwd: ROOT,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let ready = false;
    const onData = (chunk) => {
      const text = chunk.toString();
      // Until the proxy listens, nothing may print the words Lighthouse CI waits for.
      if (!ready) {
        output += text;
        if (/Ready in/.test(output)) {
          ready = true;
          resolve(child);
        }
      } else {
        process.stderr.write(`[next start] ${text}`);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => {
      if (!ready) reject(new Error(`next start stopped (exit ${code}) before it was ready:\n${output.trim()}`));
      else process.exit(code ?? 1);
    });
  });
}

async function main() {
  const { port, cookie } = parseServerArgs(process.argv.slice(2));
  const started = Date.now();
  const upstreamPort = await freePort();
  const next = await startNext(upstreamPort);
  const stop = () => {
    try {
      next.kill();
    } catch {
      // Already gone.
    }
  };
  process.on('exit', stop);
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      stop();
      process.exit(0);
    });
  }

  const proxy = createThemeProxy({ upstreamPort, cookie });
  await new Promise((resolve, reject) => {
    proxy.on('error', reject);
    proxy.listen(port, resolve);
  });

  // Check the path Lighthouse will take, on the not-found page so no measured page is warmed: an HTML
  // page through the proxy, with the cookie or without.
  const response = await fetch(`http://localhost:${port}/lighthouse-server-check`);
  await response.arrayBuffer();
  const html = /^text\/html\b/i.test(response.headers.get('content-type') ?? '');
  const setCookies = response.headers.getSetCookie().filter((value) => value.startsWith(`${THEME_COOKIE}=`));
  const expected = cookie ? [themeCookieHeader(cookie)] : [];
  if (response.status !== 404 || !html || setCookies.join('\n') !== expected.join('\n')) {
    const got = setCookies.length ? setCookies.join(', ') : 'no theme cookie';
    console.error(`Lighthouse server: the check page answered ${response.status}${html ? ' HTML' : ''} with ${got}, not a 404 page with ${expected[0] ?? 'no theme cookie'}.`);
    stop();
    process.exit(1);
  }

  const theme = cookie ? `every page sets ${THEME_COOKIE}=${cookie}` : 'no theme cookie';
  console.log(`Lighthouse server: Ready in ${Date.now() - started} ms on http://localhost:${port} (next start behind a pass-through proxy; ${theme}).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`Lighthouse server: ${error.message}`);
    process.exit(1);
  });
}
