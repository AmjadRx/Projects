#!/usr/bin/env node
/**
 * The end-to-end suite's web server, which playwright.config.ts starts: the site as visitors get
 * it, a production build served by `next start`.
 *
 * - The build is `npm run build`, with its prebuild and postbuild checks, into its own output
 *   folder (NEXT_DIST_DIR, `.next-e2e` unless E2E_DIST_DIR names another), so it never touches the
 *   main `.next` folder. npm needs MOTION_TOKEN in the environment, as every npm command here does.
 * - `next build` with NEXT_DIST_DIR adds that folder's types to tsconfig.json's include, and writes
 *   the file in its own format. The file is put back exactly as it was when the build ends, passed
 *   or failed, and when this script is stopped during the build by a signal it can hear (SIGINT,
 *   SIGTERM, SIGHUP: the handlers are in place before the build starts).
 * - A stop no script can hear (SIGKILL, or `taskkill /F`, which is how Playwright stops a server on
 *   Windows) leaves Next's tsconfig.json behind. The next run finds the entry before it builds: when
 *   that entry is the file's only difference from the committed file, it puts the committed file
 *   back; when the file holds other changes too, it stops and says so, so nothing of anyone's is
 *   lost.
 * - E2E_REUSE_BUILD=1 serves the build already in that folder, when there is one, without building
 *   again.
 * - The server listens on 127.0.0.1 at E2E_PORT (3702 by default). Playwright stops it, and this
 *   script stops `next start` with it.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const port = process.env.E2E_PORT || '3702';
const distDir = process.env.E2E_DIST_DIR || '.next-e2e';
const env = { ...process.env, NEXT_DIST_DIR: distDir, NEXT_TELEMETRY_DISABLED: '1' };
const tsconfig = path.join(root, 'tsconfig.json');
/** The entry `next build` adds to tsconfig.json's include for this output folder. */
const distTypes = `${distDir.replace(/\\/g, '/').replace(/\/+$/, '')}/types/**/*.ts`;
const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'];

/** Stops a child process and every process it started (on Windows, killing the shell alone would leave npm and Next running). */
function stopTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill('SIGTERM');
}

/** Parses JSON, or gives undefined. */
function parse(json) {
  try {
    return JSON.parse(json);
  } catch {
    return undefined;
  }
}

/** Puts back a tsconfig.json that an earlier run, stopped during its build, left with Next's entry (see the top of this file). */
function repairTsconfig() {
  const text = fs.readFileSync(tsconfig, 'utf8');
  if (!text.includes(JSON.stringify(distTypes))) return;
  const head = spawnSync('git', ['show', 'HEAD:tsconfig.json'], { cwd: root, encoding: 'utf8' });
  if (head.status !== 0) {
    console.warn(`serve: tsconfig.json lists ${distTypes}, and git cannot say whether it belongs there; it is left as it is`);
    return;
  }
  // Committed on purpose: it belongs there.
  if (head.stdout.includes(JSON.stringify(distTypes))) return;
  const now = parse(text);
  const committed = parse(head.stdout);
  if (now && committed && Array.isArray(now.include)) {
    now.include = now.include.filter((entry) => entry !== distTypes);
    if (isDeepStrictEqual(now, committed)) {
      // Without line-ending conversion, so the file is the committed bytes (git sees no change either way).
      const restored = spawnSync('git', ['-c', 'core.autocrlf=false', 'checkout', '--', 'tsconfig.json'], { cwd: root, stdio: 'inherit' });
      if (restored.status === 0) {
        console.log(`serve: tsconfig.json still listed ${distTypes}, left by an earlier run stopped during its build; the committed file is back`);
        return;
      }
    }
  }
  console.error(
    `serve: tsconfig.json lists ${distTypes}, left by an earlier run stopped during its build, and holds other changes too. Remove that entry by hand, then run again.`,
  );
  process.exit(1);
}

/** Builds the site into distDir. Resolves to true when the build passed. */
async function build() {
  const kept = fs.readFileSync(tsconfig);
  const restore = () => {
    try {
      if (!fs.readFileSync(tsconfig).equals(kept)) fs.writeFileSync(tsconfig, kept);
    } catch (error) {
      console.error(`serve: could not put tsconfig.json back (${error.message})`);
    }
  };
  let child = null;
  const onSignal = (signal) => {
    restore();
    stopTree(child);
    console.error(`serve: stopped by ${signal} during the build; tsconfig.json is as it was`);
    process.exit(1);
  };
  for (const signal of SIGNALS) process.on(signal, onSignal);
  console.log(`serve: building into ${distDir}`);
  // Through a shell, so the npm launcher is found on every platform (npm.cmd on Windows).
  child = spawn('npm run build', { cwd: root, env, stdio: 'inherit', shell: true });
  const result = await new Promise((resolve) => {
    child.on('exit', (code, signal) => resolve(code ?? signal));
    child.on('error', (error) => resolve(error.message));
  });
  for (const signal of SIGNALS) process.off(signal, onSignal);
  restore();
  if (result !== 0) console.error(`serve: the build failed (exit ${result})`);
  return result === 0;
}

repairTsconfig();
const built = fs.existsSync(path.join(root, distDir, 'BUILD_ID'));
if (process.env.E2E_REUSE_BUILD === '1' && built) console.log(`serve: using the build in ${distDir}`);
else if (!(await build())) process.exit(1);

const next = path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next');
const server = spawn(process.execPath, [next, 'start', '-p', port, '-H', '127.0.0.1'], { cwd: root, env, stdio: 'inherit' });

const stop = () => {
  if (server.exitCode === null && !server.killed) server.kill();
};
for (const signal of SIGNALS) {
  process.on(signal, () => {
    stop();
    process.exit(0);
  });
}
process.on('exit', stop);
server.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
