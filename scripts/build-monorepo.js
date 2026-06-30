#!/usr/bin/env node
/**
 * Monorepo production build — run explicitly via `npm run build` after install.
 * Never hooked to postinstall; Railway runs install then this script.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function run(label, command, extraEnv = {}) {
  console.log(`\n[build] ${label}`);
  execSync(command, {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv },
    shell: true,
  });
}

function tryRun(label, command, extraEnv = {}) {
  try {
    run(label, command, extraEnv);
    return true;
  } catch (err) {
    console.warn(`[build] ${label} failed (continuing):`, err?.message || err);
    return false;
  }
}

function viteAvailable() {
  const isWin = process.platform === 'win32';
  const binName = isWin ? 'vite.cmd' : 'vite';
  const candidates = [
    path.join(ROOT, 'node_modules', '.bin', binName),
    path.join(ROOT, 'frontend', 'node_modules', '.bin', binName),
    path.join(ROOT, 'node_modules', '.bin', 'vite'),
    path.join(ROOT, 'frontend', 'node_modules', '.bin', 'vite'),
  ];
  return candidates.some((p) => fs.existsSync(p));
}

function workspaceReady() {
  return (
    fs.existsSync(path.join(ROOT, 'node_modules')) &&
    (fs.existsSync(path.join(ROOT, 'frontend', 'node_modules')) ||
      fs.existsSync(path.join(ROOT, 'node_modules', 'edil-bingo-frontend')))
  );
}

try {
  if (!workspaceReady()) {
    console.error(
      '[build] workspace dependencies missing. Run `npm install --include=dev` at repo root first.'
    );
    process.exit(1);
  }

  if (!viteAvailable()) {
    console.error(
      '[build] vite not found. Ensure devDependencies are installed: `npm install --include=dev` at repo root.'
    );
    process.exit(1);
  }

  console.log('[build] production build — workspace deps only, no nested npm install');

  tryRun('verifier-api build', 'npm run build -w verifier-api');
  run('frontend build', 'npm run build -w frontend');
  run('admin-panel build', 'npm run build -w admin-panel', {
    VITE_BASE_PATH: process.env.VITE_BASE_PATH || '/SHULKETE100/',
  });

  console.log('\n[build] monorepo production build complete');
} catch (err) {
  console.error('[build] failed:', err?.message || err);
  process.exit(1);
}
