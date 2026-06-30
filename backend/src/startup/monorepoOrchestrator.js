const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const express = require('express');

const REPO_ROOT = path.resolve(__dirname, '../../..');

/** Public URL path for the admin panel SPA (not the /api/admin API prefix). */
const ADMIN_PANEL_PATH = '/SHULKETE100';

/** @type {import('child_process').ChildProcess | null} */
let verifierProcess = null;

function repoPath(...segments) {
  return path.join(REPO_ROOT, ...segments);
}

function distExists(relativePath) {
  return fs.existsSync(repoPath(relativePath));
}

function shouldServeStatic() {
  return process.env.SERVE_MONOREPO_STATIC !== 'false';
}

function shouldStartVerifier() {
  if (process.env.START_VERIFIER_API === 'false') return false;
  if (process.env.DISABLE_VERIFIER_API === 'true') return false;
  return distExists('verifier-api/dist/index.js');
}

function mountMonorepoStatic(app) {
  if (!shouldServeStatic()) return;

  const frontendDist = repoPath('frontend', 'dist');
  const adminDist = repoPath('admin-panel', 'dist');
  const hasFrontend = fs.existsSync(path.join(frontendDist, 'index.html'));
  const hasAdmin = fs.existsSync(path.join(adminDist, 'index.html'));

  app.get(/^\/admin\/?$/, (_req, res) => {
    res.redirect(301, ADMIN_PANEL_PATH);
  });
  app.all(/^\/admin\/.+/, (_req, res) => {
    res.status(404).type('text').send('Not Found');
  });

  if (hasAdmin) {
    const adminIndex = path.join(adminDist, 'index.html');
    const adminStatic = expressStatic(adminDist, { redirect: false });

    app.use(ADMIN_PANEL_PATH, adminStatic);

    const serveAdminSpa = (req, res, next) => {
      const suffix = req.path.slice(ADMIN_PANEL_PATH.length);
      const firstSegment = suffix.split('/').filter(Boolean)[0] || '';
      if (firstSegment && path.extname(firstSegment)) {
        return next();
      }
      return res.sendFile(adminIndex);
    };

    app.get(ADMIN_PANEL_PATH, serveAdminSpa);
    app.get(`${ADMIN_PANEL_PATH}/*`, serveAdminSpa);
    console.log(`[monorepo] admin-panel static → ${ADMIN_PANEL_PATH}`);
  }

  if (hasFrontend) {
    app.use(expressStatic(frontendDist));
    console.log('[monorepo] frontend static → /');
  }

  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (
      req.path.startsWith('/api') ||
      req.path.startsWith('/bot') ||
      req.path.startsWith('/uploads') ||
      req.path.startsWith('/socket.io') ||
      req.path.startsWith(ADMIN_PANEL_PATH)
    ) {
      return next();
    }
    if (hasFrontend && !path.extname(req.path)) {
      return res.sendFile(path.join(frontendDist, 'index.html'));
    }
    return next();
  });
}

function expressStatic(rootDir, options = {}) {
  return express.static(rootDir, {
    index: false,
    fallthrough: true,
    redirect: false,
    ...options,
  });
}

function startVerifierApiProcess() {
  if (!shouldStartVerifier()) {
    if (process.env.START_VERIFIER_API !== 'false') {
      console.warn(
        '[monorepo] verifier-api dist not found — build with npm run build:verifier or set START_VERIFIER_API=false'
      );
    }
    return;
  }

  const entry = repoPath('verifier-api', 'dist', 'index.js');
  const port = String(process.env.VERIFIER_API_PORT || '3002');

  verifierProcess = spawn(process.execPath, [entry], {
    cwd: repoPath('verifier-api'),
    env: {
      ...process.env,
      PORT: port,
      NODE_ENV: process.env.NODE_ENV || 'production',
    },
    stdio: 'inherit',
  });

  verifierProcess.on('error', (err) => {
    console.warn('[monorepo] verifier-api process error:', err?.message || err);
  });

  verifierProcess.on('exit', (code, signal) => {
    if (code !== 0 && code !== null) {
      console.warn(`[monorepo] verifier-api exited (code=${code}, signal=${signal})`);
    }
    verifierProcess = null;
  });

  console.log(`[monorepo] verifier-api started on port ${port}`);
}

function startTelegramBots() {
  if (process.env.DISABLE_TELEGRAM_BOTS === 'true') {
    console.log('[monorepo] Telegram bots disabled (DISABLE_TELEGRAM_BOTS=true)');
    return;
  }

  const { launchBot } = require('../bot');
  const { launchWithdrawBot } = require('../withdrawBot');

  launchBot().catch((err) => {
    console.warn('[monorepo] game bot failed to start:', err?.message || err);
  });

  launchWithdrawBot().catch((err) => {
    console.warn('[monorepo] withdraw bot failed to start:', err?.message || err);
  });
}

function startMonorepoServices(app) {
  mountMonorepoStatic(app);
  startVerifierApiProcess();
  startTelegramBots();
}

function shutdownMonorepoServices() {
  if (verifierProcess && !verifierProcess.killed) {
    verifierProcess.kill('SIGTERM');
  }
}

module.exports = {
  mountMonorepoStatic,
  startMonorepoServices,
  startVerifierApiProcess,
  startTelegramBots,
  shutdownMonorepoServices,
  REPO_ROOT,
  ADMIN_PANEL_PATH,
};
