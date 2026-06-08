#!/usr/bin/env node
/**
 * Monorepo postinstall — install validation only.
 * Does NOT run production builds; use `npm run build` after install completes.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function workspaceReady() {
  return (
    fs.existsSync(path.join(ROOT, 'node_modules')) &&
    (fs.existsSync(path.join(ROOT, 'frontend', 'node_modules')) ||
      fs.existsSync(path.join(ROOT, 'node_modules', 'edil-bingo-frontend')))
  );
}

if (!workspaceReady()) {
  console.warn(
    '[postinstall] workspace symlinks not ready yet — run `npm install --include=dev` at repo root if builds fail.'
  );
} else {
  console.log('[postinstall] monorepo install complete (run `npm run build` to build assets)');
}
