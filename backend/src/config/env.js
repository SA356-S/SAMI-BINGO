const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

/**
 * Load .env from the first existing candidate (backend/.env, repo root .env, cwd).
 * Safe to call once at process startup.
 */
function loadEnvFiles() {
  const candidates = [
    path.resolve(__dirname, '../../.env'),
    path.resolve(__dirname, '../../../.env'),
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), 'backend/.env'),
  ];

  for (const envPath of candidates) {
    if (!fs.existsSync(envPath)) continue;
    const result = dotenv.config({ path: envPath });
    if (!result.error) {
      return envPath;
    }
  }

  dotenv.config();
  return null;
}

function loadEnv() {
  const loadedFrom = loadEnvFiles();
  const { normalizeEnv } = require('./normalizeEnv');
  normalizeEnv();
  return loadedFrom;
}

module.exports = { loadEnv };
