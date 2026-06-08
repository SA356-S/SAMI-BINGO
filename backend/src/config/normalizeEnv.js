/**
 * Map deployment env aliases without changing service code paths.
 * Safe to call after loadEnv().
 */
function normalizeEnv() {
  if (!process.env.BOT_TOKEN && process.env.GAME_BOT_TOKEN) {
    process.env.BOT_TOKEN = process.env.GAME_BOT_TOKEN;
  }

  if (!process.env.MONGO_URI && process.env.DATABASE_URL) {
    process.env.MONGO_URI = process.env.DATABASE_URL;
  }

  if (!process.env.MONGO_URI && process.env.MONGODB_URI) {
    process.env.MONGO_URI = process.env.MONGODB_URI;
  }

  const verifierPort = String(process.env.VERIFIER_API_PORT || '3002').trim();

  if (!process.env.VERIFIER_API_URL && process.env.START_VERIFIER_API !== 'false') {
    process.env.VERIFIER_API_URL = `http://127.0.0.1:${verifierPort}`;
  }
}

module.exports = { normalizeEnv };
