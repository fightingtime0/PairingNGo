'use strict';

/*
 * Starts a throwaway server on port 3999 with its own temp data directory,
 * runs lib/e2e.js against it, then shuts down and cleans up.
 *
 *   node lib/e2e-run.js     (or: npm run test:e2e)
 *
 * lib/e2e.js on its own assumes a server is ALREADY listening on 3999 and
 * fails with a bare "fetch failed" if one is not. This wrapper removes that
 * footgun, and keeps test data out of your real data/ directory.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 3999;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'onic-e2e-'));
const root = path.join(__dirname, '..');

const server = spawn(process.execPath, [path.join(root, 'server.js')], {
  env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir },
  stdio: ['ignore', 'pipe', 'inherit'],
});

let done = false;
function cleanup(code) {
  if (done) return;
  done = true;
  if (!server.killed) server.kill();
  try {
    fs.rmSync(dataDir, { recursive: true, force: true });
  } catch { /* best effort */ }
  process.exit(code);
}

process.on('SIGINT', () => cleanup(1));
process.on('SIGTERM', () => cleanup(1));

server.on('error', (err) => {
  console.error('Could not start the server:', err.message);
  cleanup(1);
});

server.on('exit', (code) => {
  if (!done) {
    console.error(`Server exited early with code ${code}. Is port ${PORT} already in use?`);
    cleanup(1);
  }
});

async function waitForServer(timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/tournaments`);
      if (res.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

(async () => {
  server.stdout.resume(); // drain the startup banner

  if (!(await waitForServer())) {
    console.error(`Server did not come up on port ${PORT} within 10s.`);
    return cleanup(1);
  }

  // The suite writes one hand-made legacy file into the same data directory to
  // prove the migration, so it needs to know where that is.
  const child = spawn(process.execPath, [path.join(__dirname, 'e2e.js')], {
    env: { ...process.env, DATA_DIR: dataDir },
    stdio: 'inherit',
  });
  child.on('exit', (code) => cleanup(code === 0 ? 0 : 1));
})();
