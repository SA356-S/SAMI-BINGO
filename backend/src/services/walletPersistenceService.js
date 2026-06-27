const { mongoose } = require('../config/db');
const { UserWalletModel } = require('../models/UserWallet');

function isDbReady() {
  return mongoose.connection?.readyState === 1;
}

function normalizeWallet(doc) {
  if (!doc) return { main: 0, play: 0 };
  return {
    main: Math.max(0, Number(doc.mainWallet) || 0),
    play: Math.max(0, Number(doc.playWallet) || 0),
  };
}

/**
 * Load wallet from MongoDB into the shape walletManager expects.
 */
async function loadWalletFromDb(userId) {
  const key = String(userId);
  if (!isDbReady()) return { main: 0, play: 0 };

  const doc = await UserWalletModel.findOne({ userId: key }).lean();
  return normalizeWallet(doc);
}

/**
 * Upsert full wallet balances (used after in-memory mutations).
 */
async function saveWalletToDb(userId, wallet, extras = {}) {
  const key = String(userId);
  if (!isDbReady()) return null;

  const main = Math.max(0, Number(wallet?.main) || 0);
  const play = Math.max(0, Number(wallet?.play) || 0);

  const set = {
    mainWallet: main,
    playWallet: play,
    ...extras,
  };

  const telegramId = Number(key);
  if (Number.isFinite(telegramId) && telegramId > 0) {
    set.telegramId = telegramId;
  }

  return UserWalletModel.findOneAndUpdate(
    { userId: key },
    { $set: set, $setOnInsert: { userId: key } },
    { upsert: true, new: true, lean: true }
  );
}

/**
 * Credit play wallet atomically (admin deposits, Telegram deposits).
 */
async function creditPlayWalletDb(userId, amount, meta = {}) {
  const key = String(userId);
  const value = Math.max(0, Number(amount) || 0);
  if (value <= 0) {
    return { ok: false, error: 'Invalid deposit amount' };
  }
  if (!isDbReady()) {
    return { ok: false, error: 'database_unavailable' };
  }

  const telegramId = Number(key);
  const update = {
    $inc: { playWallet: value, totalDeposits: value },
    $set: meta,
    $setOnInsert: { userId: key, mainWallet: 0 },
  };
  if (Number.isFinite(telegramId) && telegramId > 0) {
    update.$setOnInsert.telegramId = telegramId;
  }

  const doc = await UserWalletModel.findOneAndUpdate(
    { userId: key },
    update,
    { upsert: true, new: true, lean: true }
  );

  const wallet = normalizeWallet(doc);
  return { ok: true, wallet, credited: value, doc };
}

/**
 * Debit play wallet atomically.
 */
async function debitPlayWalletDb(userId, amount) {
  const key = String(userId);
  const value = Math.max(0, Number(amount) || 0);
  if (value <= 0) {
    return { ok: false, error: 'Invalid deduction amount' };
  }
  if (!isDbReady()) {
    return { ok: false, error: 'database_unavailable' };
  }

  const current = await UserWalletModel.findOne({ userId: key }).lean();
  const play = Math.max(0, Number(current?.playWallet) || 0);
  if (play < value) {
    return {
      ok: false,
      error: 'Insufficient play wallet balance',
      wallet: normalizeWallet(current),
      required: value,
      available: play,
    };
  }

  const doc = await UserWalletModel.findOneAndUpdate(
    { userId: key },
    { $inc: { playWallet: -value } },
    { new: true, lean: true }
  );

  return { ok: true, wallet: normalizeWallet(doc), deducted: value };
}

/**
 * Credit main wallet (bingo wins).
 */
async function creditMainWalletDb(userId, amount) {
  const key = String(userId);
  const value = Math.max(0, Number(amount) || 0);
  if (value <= 0) {
    return { ok: false, error: 'Invalid prize amount' };
  }
  if (!isDbReady()) {
    return { ok: false, error: 'database_unavailable' };
  }

  const telegramId = Number(key);
  const update = {
    $inc: { mainWallet: value },
    $setOnInsert: { userId: key, playWallet: 0 },
  };
  if (Number.isFinite(telegramId) && telegramId > 0) {
    update.$setOnInsert.telegramId = telegramId;
  }

  const doc = await UserWalletModel.findOneAndUpdate(
    { userId: key },
    update,
    { upsert: true, new: true, lean: true }
  );

  return { ok: true, wallet: normalizeWallet(doc) };
}

/**
 * Debit main wallet (withdrawals).
 */
async function debitMainWalletDb(userId, amount) {
  const key = String(userId);
  const value = Math.max(0, Number(amount) || 0);
  if (value <= 0) {
    return { ok: false, error: 'Invalid withdraw amount' };
  }
  if (!isDbReady()) {
    return { ok: false, error: 'database_unavailable' };
  }

  const current = await UserWalletModel.findOne({ userId: key }).lean();
  const main = Math.max(0, Number(current?.mainWallet) || 0);
  if (main < value) {
    return {
      ok: false,
      error: 'Insufficient main wallet balance',
      wallet: normalizeWallet(current),
      required: value,
      available: main,
    };
  }

  const doc = await UserWalletModel.findOneAndUpdate(
    { userId: key },
    { $inc: { mainWallet: -value, totalWithdrawals: value } },
    { new: true, lean: true }
  );

  return { ok: true, wallet: normalizeWallet(doc), withdrawn: value };
}

/**
 * Load every persisted wallet into the in-memory cache on server startup.
 * Set HYDRATE_ALL_WALLETS=true to restore previous eager hydration behavior.
 */
async function hydrateAllWalletsFromDb(setCacheEntry) {
  if (process.env.HYDRATE_ALL_WALLETS !== 'true') {
    console.log('[wallet] lazy hydration enabled — wallets load on first access');
    return 0;
  }

  if (!isDbReady()) {
    console.warn('[wallet] DB not ready — skipping wallet hydration');
    return 0;
  }

  const docs = await UserWalletModel.find().lean();
  let count = 0;

  for (const doc of docs) {
    const key = String(doc.userId);
    const wallet = normalizeWallet(doc);
    setCacheEntry(key, wallet);
    count += 1;
  }

  console.log(`[wallet] hydrated ${count} wallet(s) from MongoDB`);
  return count;
}

/**
 * Sync profile hints onto wallet document (optional, for admin search).
 */
async function syncWalletUserMeta(userId, { username, phone } = {}) {
  const key = String(userId);
  if (!isDbReady()) return;

  const set = {};
  if (username) set.username = String(username);
  if (phone) set.phone = String(phone);

  if (Object.keys(set).length === 0) return;

  await UserWalletModel.updateOne(
    { userId: key },
    { $set: set },
    { upsert: true }
  );
}

module.exports = {
  isDbReady,
  loadWalletFromDb,
  saveWalletToDb,
  creditPlayWalletDb,
  debitPlayWalletDb,
  creditMainWalletDb,
  debitMainWalletDb,
  hydrateAllWalletsFromDb,
  syncWalletUserMeta,
  normalizeWallet,
};
