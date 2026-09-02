/**
 * Map deployment env aliases without changing service code paths.
 * Safe to call after loadEnv().
 */
function alias(canonical, ...sources) {
  if (String(process.env[canonical] || '').trim()) return;
  for (const key of sources) {
    const value = String(process.env[key] || '').trim();
    if (value) {
      process.env[canonical] = value;
      return;
    }
  }
}

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

  alias(
    'DEPOSIT_CBEBIRR_NUMBER',
    'DEPOSIT_CBE_NUMBER',
    'DEPOSIT_CBE_BIRR_NUMBER',
    'CBEBIRR_NUMBER',
    'CBE_NUMBER',
    'CBE_PHONE'
  );
  alias(
    'DEPOSIT_CBEBIRR_RECEIVER_NAME',
    'DEPOSIT_CBE_RECEIVER_NAME',
    'DEPOSIT_CBE_NAME',
    'CBEBIRR_RECEIVER_NAME',
    'CBE_RECEIVER_NAME',
    'CBE_NAME'
  );
  alias(
    'DEPOSIT_CBEBIRR_ACCOUNT',
    'DEPOSIT_CBE_ACCOUNT',
    'DEPOSIT_CBE_BIRR_ACCOUNT',
    'CBEBIRR_ACCOUNT',
    'CBE_ACCOUNT'
  );
  alias(
    'DEPOSIT_CBEBIRR_ACCOUNTS',
    'DEPOSIT_CBE_ACCOUNTS',
    'CBEBIRR_ACCOUNTS'
  );
}

module.exports = { normalizeEnv };
