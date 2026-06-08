const { mongoose } = require('../config/db');
const { TelegramUserModel } = require('../models/TelegramUser');
const { ROLES, normalizeRole, isPanelRole } = require('../constants/roles');

function isDbReady() {
  return mongoose.connection?.readyState === 1;
}

function parseTelegramId(id) {
  const raw = String(id || '').trim();
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function formatManagedUser(doc) {
  if (!doc) return null;
  const role = normalizeRole(doc.role);
  const username =
    doc.username ||
    [doc.firstName, doc.lastName].filter(Boolean).join(' ').trim() ||
    String(doc.telegramId);

  return {
    id: String(doc._id ?? doc.telegramId),
    userId: String(doc.telegramId),
    telegramId: Number(doc.telegramId),
    username,
    firstName: doc.firstName || '',
    lastName: doc.lastName || '',
    role,
    roleLabel: role.toUpperCase(),
    isBanned: Boolean(doc.isBanned),
    banReason: doc.banReason || '',
    bannedAt: doc.bannedAt || null,
    status: doc.isBanned ? 'banned' : 'active',
    registrationStatus: doc.registrationStatus || 'pending',
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

async function findUserByParam(id) {
  if (!isDbReady()) {
    return { ok: false, error: 'database_unavailable', message: 'Database is not connected' };
  }

  const telegramId = parseTelegramId(id);
  if (!telegramId) {
    return { ok: false, error: 'invalid_user_id', message: 'User id must be a numeric Telegram id' };
  }

  const user = await TelegramUserModel.findOne({ telegramId }).lean();
  if (!user) {
    return { ok: false, error: 'user_not_found', message: 'User not found' };
  }

  return { ok: true, user };
}

async function listUsersForManagement({ limit = 50, skip = 0, search } = {}) {
  if (!isDbReady()) {
    return { ok: false, error: 'database_unavailable', message: 'Database is not connected' };
  }

  const cap = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const offset = Math.max(Number(skip) || 0, 0);
  const q = String(search || '').trim();

  const filter = {};
  if (q) {
    const asNum = Number(q);
    if (Number.isFinite(asNum) && asNum > 0) {
      filter.telegramId = asNum;
    } else {
      const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [
        { username: regex },
        { firstName: regex },
        { lastName: regex },
      ];
    }
  }

  const [users, total] = await Promise.all([
    TelegramUserModel.find(filter)
      .sort({ updatedAt: -1 })
      .skip(offset)
      .limit(cap)
      .lean(),
    TelegramUserModel.countDocuments(filter),
  ]);

  return {
    ok: true,
    total,
    users: users.map(formatManagedUser),
  };
}

async function setUserRole(telegramIdParam, nextRole) {
  const found = await findUserByParam(telegramIdParam);
  if (!found.ok) return found;

  const role = normalizeRole(nextRole);
  const updated = await TelegramUserModel.findOneAndUpdate(
    { telegramId: found.user.telegramId },
    { $set: { role } },
    { new: true }
  ).lean();

  return { ok: true, user: formatManagedUser(updated) };
}

async function makeAdmin(telegramIdParam) {
  return setUserRole(telegramIdParam, ROLES.ADMIN);
}

async function removeAdmin(telegramIdParam) {
  return setUserRole(telegramIdParam, ROLES.USER);
}

async function makeManager(telegramIdParam) {
  return setUserRole(telegramIdParam, ROLES.MANAGER);
}

async function removeManager(telegramIdParam, targetRole = ROLES.ADMIN) {
  const next = normalizeRole(targetRole);
  if (next === ROLES.MANAGER) {
    return { ok: false, error: 'invalid_target_role', message: 'Cannot demote manager to manager' };
  }
  return setUserRole(telegramIdParam, next === ROLES.USER ? ROLES.USER : ROLES.ADMIN);
}

async function banUser(telegramIdParam, banReason = '') {
  const found = await findUserByParam(telegramIdParam);
  if (!found.ok) return found;

  const updated = await TelegramUserModel.findOneAndUpdate(
    { telegramId: found.user.telegramId },
    {
      $set: {
        isBanned: true,
        banReason: String(banReason || '').trim().slice(0, 500),
        bannedAt: new Date(),
      },
    },
    { new: true }
  ).lean();

  return { ok: true, user: formatManagedUser(updated) };
}

async function unbanUser(telegramIdParam) {
  const found = await findUserByParam(telegramIdParam);
  if (!found.ok) return found;

  const updated = await TelegramUserModel.findOneAndUpdate(
    { telegramId: found.user.telegramId },
    {
      $set: {
        isBanned: false,
        banReason: '',
        bannedAt: null,
      },
    },
    { new: true }
  ).lean();

  return { ok: true, user: formatManagedUser(updated) };
}

async function getBanStatus(telegramIdParam) {
  const found = await findUserByParam(telegramIdParam);
  if (!found.ok) return { ok: false, banned: false };

  return {
    ok: true,
    banned: Boolean(found.user.isBanned),
    banReason: found.user.banReason || '',
    bannedAt: found.user.bannedAt || null,
  };
}

async function assertUserNotBanned(telegramIdParam) {
  const key = parseTelegramId(telegramIdParam) ?? String(telegramIdParam || '').trim();
  if (!key) {
    return { ok: true, banned: false };
  }

  if (!isDbReady()) {
    return { ok: true, banned: false };
  }

  const user = await TelegramUserModel.findOne({ telegramId: Number(key) })
    .select('isBanned banReason bannedAt role')
    .lean();

  if (!user) {
    return { ok: true, banned: false };
  }

  if (user.isBanned) {
    return {
      ok: false,
      banned: true,
      error: 'user_banned',
      message: user.banReason || 'Your account has been suspended.',
      banReason: user.banReason || '',
      bannedAt: user.bannedAt || null,
    };
  }

  return { ok: true, banned: false, role: normalizeRole(user.role) };
}

async function resolvePanelLogin(telegramIdParam) {
  const found = await findUserByParam(telegramIdParam);
  if (!found.ok) return found;

  const role = normalizeRole(found.user.role);
  if (!isPanelRole(role)) {
    return {
      ok: false,
      error: 'not_authorized',
      message: 'This Telegram account does not have admin panel access.',
    };
  }

  if (found.user.isBanned) {
    return {
      ok: false,
      error: 'user_banned',
      message: 'This account is banned and cannot access the admin panel.',
    };
  }

  return {
    ok: true,
    role,
    telegramId: found.user.telegramId,
    user: formatManagedUser(found.user),
  };
}

async function bootstrapManagerIfNeeded(telegramId) {
  const bootstrapId = String(process.env.BOOTSTRAP_MANAGER_TELEGRAM_ID || '').trim();
  const id = parseTelegramId(telegramId);
  if (!bootstrapId || !id || String(id) !== bootstrapId) return null;

  if (!isDbReady()) return null;

  const managerCount = await TelegramUserModel.countDocuments({ role: ROLES.MANAGER });
  if (managerCount > 0) return null;

  const updated = await TelegramUserModel.findOneAndUpdate(
    { telegramId: id },
    {
      $set: { role: ROLES.MANAGER, chatId: id },
      $setOnInsert: { telegramId: id, registrationStatus: 'pending' },
    },
    { upsert: true, new: true, lean: true }
  );

  if (updated) {
    console.info('[roles] bootstrap manager assigned', { telegramId: id, role: ROLES.MANAGER });
  }

  return updated ? formatManagedUser(updated) : null;
}

module.exports = {
  formatManagedUser,
  listUsersForManagement,
  makeAdmin,
  removeAdmin,
  makeManager,
  removeManager,
  banUser,
  unbanUser,
  getBanStatus,
  assertUserNotBanned,
  resolvePanelLogin,
  bootstrapManagerIfNeeded,
  parseTelegramId,
};
