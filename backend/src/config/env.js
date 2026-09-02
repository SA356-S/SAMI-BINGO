const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

/**
 * Load .env from the first existing candidate (backend/.env, repo root .env, cwd).
 * Safe to call once at process startup.
 */
function applyParsedEnv(parsed) {
  if (!parsed || typeof parsed !== 'object') return;
  for (const [key, value] of Object.entries(parsed)) {
    const next = String(value ?? '').trim();
    if (!next) continue;
    if (!String(process.env[key] ?? '').trim()) {
      process.env[key] = next;
    }
  }
}

function loadEnvFiles() {
  const candidates = [
    path.resolve(__dirname, '../../.env'),
    path.resolve(__dirname, '../../../.env'),
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), 'backend/.env'),
  ];

  let loadedFrom = null;
  const seen = new Set();
  for (const envPath of candidates) {
    if (!fs.existsSync(envPath) || seen.has(envPath)) continue;
    seen.add(envPath);
    const result = dotenv.config({ path: envPath });
    if (result.error) continue;
    applyParsedEnv(result.parsed);
    if (!loadedFrom) loadedFrom = envPath;
  }

  if (!loadedFrom) {
    const result = dotenv.config();
    applyParsedEnv(result.parsed);
  }
  return loadedFrom;
}

function loadEnv() {
  const loadedFrom = loadEnvFiles();
  const { normalizeEnv } = require('./normalizeEnv');
  normalizeEnv();
  return loadedFrom;
}

module.exports = { loadEnv };
