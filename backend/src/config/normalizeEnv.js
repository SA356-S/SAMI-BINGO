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

  if (!String(process.env.QBIRR_BASE_URL || '').trim()) {
    process.env.QBIRR_BASE_URL = 'https://verify.qbirr.com';
  }
}

module.exports = { normalizeEnv };
