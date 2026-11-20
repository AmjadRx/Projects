#!/usr/bin/env node
/**
 * The end-to-end suite's web server, which playwright.config.ts starts: the site as visitors get
 * it, a production build served by `next start`.
 *
 * - The build is `npm run build`, with its prebuild and postbuild checks, into its own output
 *   folder (NEXT_DIST_DIR, `.next-e2e` unless E2E_DIST_DIR names another), so it never touches the
 *   main `.next` folder. npm needs MOTION_TOKEN in the environment, as every npm command here does.
 * - `next build` with NEXT_DIST_DIR adds that folder's types to tsconfig.json; the file is put back
 *   exactly as it was once the build ends, whether it passed or failed.
 * - E2E_REUSE_BUILD=1 serves the build already in that folder, when there is one, without building
 *   again.
 * - The server listens on 127.0.0.1 at E2E_PORT (3702 by default). Playwright stops it, and this
 *   script stops `next start` with it.
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const port = process.env.E2E_PORT || '3702';
const distDir = process.env.E2E_DIST_DIR || '.next-e2e';
const env = { ...process.env, NEXT_DIST_DIR: distDir, NEXT_TELEMETRY_DISABLED: '1' };

const built = fs.existsSync(path.join(root, distDir, 'BUILD_ID'));
if (process.env.E2E_REUSE_BUILD === '1' && built) {
  console.log(`serve: using the build in ${distDir}`);
} else {
  const tsconfig = path.join(root, 'tsconfig.json');
  const kept = fs.readFileSync(tsconfig);
  let result;
  try {
    console.log(`serve: building into ${distDir}`);
    // Through a shell, so the npm launcher is found on every platform (npm.cmd on Windows).
    result = spawnSync('npm run build', { cwd: root, env, stdio: 'inherit', shell: true });
  } finally {
    fs.writeFileSync(tsconfig, kept);
  }
  if (result.status !== 0) {
    console.error(`serve: the build failed (exit ${result.status ?? result.signal})`);
    process.exit(1);
  }
}

const next = path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next');
const server = spawn(process.execPath, [next, 'start', '-p', port, '-H', '127.0.0.1'], { cwd: root, env, stdio: 'inherit' });

const stop = () => {
  if (server.exitCode === null && !server.killed) server.kill();
};
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    stop();
    process.exit(0);
  });
}
process.on('exit', stop);
server.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
