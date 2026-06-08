#!/usr/bin/env node
/**
 * Monorepo postinstall — runs after a single root `npm install` (npm workspaces).
 * Builds production assets only. Never runs nested `npm install`.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function run(label, command, extraEnv = {}) {
  console.log(`\n[postinstall] ${label}`);
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
    console.warn(`[postinstall] ${label} failed (continuing):`, err?.message || err);
    return false;
  }
}

function workspaceReady() {
  return (
    fs.existsSync(path.join(ROOT, 'node_modules')) ||
    fs.existsSync(path.join(ROOT, 'frontend', 'node_modules'))
  );
}

function shouldBuildAssets() {
  if (process.env.SKIP_MONOREPO_BUILD === 'true') return false;
  if (process.env.npm_lifecycle_event === 'build') return true;
  if (process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID) return true;
  if (process.env.NODE_ENV === 'production') return true;
  if (process.env.BUILD_MONOREPO === 'true') return true;
  return false;
}

function runProductionBuilds() {
  tryRun('verifier-api build', 'npm run build -w verifier-api');
  run('frontend build', 'npm run build -w frontend');
  run('admin-panel build', 'npm run build -w admin-panel', {
    VITE_BASE_PATH: process.env.VITE_BASE_PATH || '/admin/',
  });
}

try {
  if (!shouldBuildAssets()) {
    console.log(
      '[postinstall] skipping production builds (local dev). Set BUILD_MONOREPO=true to build.'
    );
    console.log('[postinstall] monorepo install complete');
    process.exit(0);
  }

  if (!workspaceReady()) {
    console.error(
      '[postinstall] workspace dependencies missing. Run `npm install --include=dev` at repo root.'
    );
    process.exit(1);
  }

  console.log('[postinstall] production build — workspace deps only, no nested npm install');
  runProductionBuilds();
  console.log('\n[postinstall] monorepo production build complete');
} catch (err) {
  console.error('[postinstall] failed:', err?.message || err);
  process.exit(1);
}
