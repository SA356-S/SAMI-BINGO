const { mongoose } = require('../config/db');
const { TelegramUserModel } = require('../models/TelegramUser');
const { UserProfileModel } = require('../models/UserProfile');
const {
  getWalletBalanceAsync,
  creditDepositAsync,
  toSnapshot,
  ensureWalletLoaded,
} = require('../socket/walletManager');
const { syncWalletUserMeta } = require('./walletPersistenceService');
const { recordTransaction } = require('./walletTransactionService');

function isDbReady() {
  return mongoose.connection?.readyState === 1;
}

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Build phone digit variants (251…, 09…, local) for flexible matching. */
function buildPhoneDigitVariants(query) {
  const digits = String(query || '').replace(/\D/g, '');
  if (digits.length < 4) return [];

  const variants = new Set([digits]);

  if (digits.startsWith('0') && digits.length >= 9) {
    variants.add(`251${digits.slice(1)}`);
  }
  if (digits.startsWith('251') && digits.length > 3) {
    variants.add(`0${digits.slice(3)}`);
    variants.add(digits.slice(3));
  }
  if (!digits.startsWith('251') && digits.length >= 9) {
    variants.add(`251${digits}`);
  }

  return [...variants].filter((v) => v.length >= 4);
}

async function formatUserRow(telegramUser, profile) {
  const userId = String(telegramUser?.telegramId ?? profile?.userId ?? '');
  await ensureWalletLoaded(userId);
  const wallet = await getWalletBalanceAsync(userId);
  const firstName = telegramUser?.firstName || '';
  const lastName = telegramUser?.lastName || '';
  const name =
    profile?.displayName ||
    `${firstName} ${lastName}`.trim() ||
    telegramUser?.username ||
    userId;

  return {
    userId,
    telegramId: Number(telegramUser?.telegramId) || Number(userId) || 0,
    username: telegramUser?.username || '',
    name,
    phone:
      telegramUser?.phoneNumber ||
      profile?.phone ||
      '',
    registrationStatus:
      telegramUser?.registrationStatus || (profile ? 'profile' : 'unknown'),
    mainWallet: wallet.mainWallet,
    playWallet: wallet.playWallet,
    totalWalletBalance: wallet.totalWalletBalance,
  };
}

async function findTelegramUserByUserId(userId) {
  const key = String(userId).trim();
  if (!key) return null;

  if (/^\d+$/.test(key)) {
    return TelegramUserModel.findOne({ telegramId: Number(key) }).lean();
  }
  return null;
}

async function enrichUsers(telegramUsers, profileRows = []) {
  const byUserId = new Map();

  for (const row of telegramUsers) {
    const key = String(row.telegramId);
    byUserId.set(key, { telegramUser: row, profile: null });
  }

  const profileOnly = [];
  for (const profile of profileRows) {
    const key = String(profile.userId);
    if (byUserId.has(key)) {
      byUserId.get(key).profile = profile;
      continue;
    }
    profileOnly.push(profile);
    byUserId.set(key, { telegramUser: null, profile });
  }

  const missingIds = [...byUserId.values()]
    .filter((entry) => entry.telegramUser && !entry.profile)
    .map((entry) => String(entry.telegramUser.telegramId));

  if (missingIds.length > 0) {
    const profiles = await UserProfileModel.find({
      userId: { $in: missingIds },
    }).lean();
    for (const profile of profiles) {
      const entry = byUserId.get(profile.userId);
      if (entry) entry.profile = profile;
    }
  }

  const rows = [];

  for (const entry of byUserId.values()) {
    if (entry.telegramUser) {
      rows.push(formatUserRow(entry.telegramUser, entry.profile));
      continue;
    }
    if (entry.profile) {
      rows.push(
        findTelegramUserByUserId(entry.profile.userId).then((telegramUser) =>
          formatUserRow(telegramUser, entry.profile)
        )
      );
    }
  }

  return Promise.all(rows);
}

async function searchUsers(query) {
  const q = String(query || '').trim();
  if (!q) {
    return {
      ok: false,
      error: 'query_required',
      message: 'Search query is required',
    };
  }

  if (!isDbReady()) {
    return {
      ok: false,
      error: 'database_unavailable',
      message: 'Database is not connected. Start the backend and check MONGO_URI.',
    };
  }

  const telegramConditions = [];
  const profileConditions = [];
  const asNum = Number(q);

  if (Number.isFinite(asNum) && asNum > 0) {
    telegramConditions.push({ telegramId: asNum });
    profileConditions.push({ userId: String(asNum) });
  }

  const phoneVariants = buildPhoneDigitVariants(q);
  for (const digits of phoneVariants) {
    const phoneRegex = new RegExp(escapeRegex(digits), 'i');
    telegramConditions.push({ phoneNumber: phoneRegex });
    profileConditions.push({ phone: phoneRegex });
  }

  const bareUsername = q.replace(/^@/, '').trim();
  if (bareUsername.length >= 2) {
    const userRegex = new RegExp(escapeRegex(bareUsername), 'i');
    telegramConditions.push({ username: userRegex });
    telegramConditions.push({ firstName: userRegex });
    telegramConditions.push({ lastName: userRegex });
    profileConditions.push({ displayName: userRegex });
    profileConditions.push({ inviteCode: userRegex });
    profileConditions.push({ userId: userRegex });
  }

  if (telegramConditions.length === 0 && profileConditions.length === 0) {
    return {
      ok: false,
      error: 'query_too_short',
      message: 'Enter at least 2 characters for username or 4 digits for phone',
    };
  }

  const [telegramUsers, profileMatches] = await Promise.all([
    telegramConditions.length > 0
      ? TelegramUserModel.find({ $or: telegramConditions }).limit(20).lean()
      : [],
    profileConditions.length > 0
      ? UserProfileModel.find({ $or: profileConditions }).limit(20).lean()
      : [],
  ]);

  const users = await enrichUsers(telegramUsers, profileMatches);

  const unique = new Map();
  for (const row of users) {
    if (!row.userId) continue;
    unique.set(row.userId, row);
  }
  const list = [...unique.values()];

  if (list.length === 0) {
    return {
      ok: false,
      error: 'user_not_found',
      message:
        'No user found. Users appear after they use /start in the Telegram bot or open the Mini App.',
    };
  }

  if (list.length === 1) {
    return { ok: true, user: list[0], users: list };
  }

  return { ok: true, users: list };
}

async function listRecentUsers(limit = 25) {
  if (!isDbReady()) {
    return {
      ok: false,
      error: 'database_unavailable',
      message: 'Database is not connected',
    };
  }

  const cap = Math.min(Math.max(Number(limit) || 25, 1), 100);
  const telegramUsers = await TelegramUserModel.find()
    .sort({ updatedAt: -1 })
    .limit(cap)
    .lean();

  const users = await enrichUsers(telegramUsers);
  return { ok: true, total: users.length, users };
}

async function addBalance(userId, amount, note) {
  const key = String(userId || '').trim();
  if (!key) {
    return { ok: false, error: 'user_id_required', message: 'User ID is required' };
  }

  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) {
    return {
      ok: false,
      error: 'invalid_amount',
      message: 'Amount must be a positive number',
    };
  }

  if (!isDbReady()) {
    return {
      ok: false,
      error: 'database_unavailable',
      message: 'Database is not connected',
    };
  }

  const telegramUser = await findTelegramUserByUserId(key);
  const profile = await UserProfileModel.findOne({ userId: key }).lean();

  if (!telegramUser && !profile) {
    return {
      ok: false,
      error: 'user_not_found',
      message: 'User not found in database',
    };
  }

  const meta = {};
  if (telegramUser?.username) meta.username = telegramUser.username;
  if (telegramUser?.phoneNumber || profile?.phone) {
    meta.phone = telegramUser?.phoneNumber || profile?.phone;
  }

  const result = await creditDepositAsync(key, value, meta);
  if (!result.ok) {
    return {
      ok: false,
      error: result.error || 'credit_failed',
      message: result.error || 'Failed to credit balance',
    };
  }

  await recordTransaction(key, {
    type: 'deposit',
    amount: value,
    channel: 'ADMIN',
    detail: note || 'Admin balance credit',
  });

  await syncWalletUserMeta(key, meta);

  try {
    const { notifyAdminBalanceCredit } = require('./adminBalanceNotifyService');
    await notifyAdminBalanceCredit({
      userId: key,
      amount: value,
      wallet: result.wallet,
      note: note || 'Admin balance credit',
    });
  } catch (err) {
    console.warn('[users] admin balance notify failed', {
      userId: key,
      error: err?.message || err,
    });
  }

  const snapshot = toSnapshot(result.wallet);
  const enriched = await formatUserRow(telegramUser, profile);

  return {
    ok: true,
    userId: key,
    amount: value,
    persisted: result.persisted !== false,
    user: enriched,
    ...snapshot,
  };
}

module.exports = { searchUsers, listRecentUsers, addBalance, isDbReady };
