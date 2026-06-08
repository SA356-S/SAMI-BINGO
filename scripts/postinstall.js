#!/usr/bin/env node
/**
 * Monorepo install — runs on `npm install` at repo root (Railway + local).
 * Installs all packages; builds production assets when deploying.
 */
const { execSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function run(label, command, cwd = ROOT, extraEnv = {}) {
  console.log(`\n[postinstall] ${label}`);
  execSync(command, {
    cwd,
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv },
    shell: true,
  });
}

function tryRun(label, command, cwd = ROOT, extraEnv = {}) {
  try {
    run(label, command, cwd, extraEnv);
    return true;
  } catch (err) {
    console.warn(`[postinstall] ${label} failed (continuing):`, err?.message || err);
    return false;
  }
}

function shouldBuildAssets() {
  if (process.env.SKIP_MONOREPO_BUILD === 'true') return false;
  if (process.env.npm_lifecycle_event === 'build') return true;
  if (process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID) return true;
  if (process.env.NODE_ENV === 'production') return true;
  if (process.env.BUILD_MONOREPO === 'true') return true;
  return false;
}

try {
  run('backend dependencies', 'npm install --prefix backend');

  if (shouldBuildAssets()) {
    tryRun('verifier-api dependencies', 'npm install --prefix verifier-api');
    tryRun('verifier-api build', 'npm run build --prefix verifier-api');

    run('frontend dependencies', 'npm install --prefix frontend');
    run('frontend build', 'npm run build --prefix frontend');

    run('admin-panel dependencies', 'npm install --prefix admin-panel');
    run(
      'admin-panel build',
      'npm run build --prefix admin-panel',
      ROOT,
      { VITE_BASE_PATH: process.env.VITE_BASE_PATH || '/admin/' }
    );
  } else {
    console.log('[postinstall] skipping asset builds (set BUILD_MONOREPO=true or deploy on Railway to build)');
  }

  console.log('\n[postinstall] monorepo install complete');
} catch (err) {
  console.error('[postinstall] failed:', err?.message || err);
  process.exit(1);
}
