const { TelegramUserModel } = require('../models/TelegramUser');

function normalizeTelegramId(id) {
  return Number(id);
}

function normalizeUsername(username) {
  if (!username) return '';
  const value = String(username).trim();
  return value.startsWith('@') ? value : `@${value}`;
}

async function findByTelegramId(telegramId) {
  const id = normalizeTelegramId(telegramId);
  if (!Number.isFinite(id)) return null;
  return TelegramUserModel.findOne({ telegramId: id }).lean();
}

/**
 * Upsert Telegram profile fields from Mini App / socket (does not reset registration).
 */
async function syncTelegramProfileFromClient({
  telegramId,
  username,
  firstName,
  lastName,
}) {
  const id = normalizeTelegramId(telegramId);
  if (!Number.isFinite(id)) return null;

  const set = {};
  if (username) set.username = normalizeUsername(username);
  if (firstName) set.firstName = String(firstName).trim();
  if (lastName) set.lastName = String(lastName).trim();

  if (Object.keys(set).length === 0) {
    const existing = await findByTelegramId(id);
    if (existing) {
      console.log('[telegram] DB user loaded', {
        telegramId: id,
        username: existing.username,
        phone: existing.phoneNumber ? '(set)' : '(empty)',
      });
    }
    return existing;
  }

  const user = await TelegramUserModel.findOneAndUpdate(
    { telegramId: id },
    {
      $set: { ...set, chatId: id },
      $setOnInsert: { telegramId: id, registrationStatus: 'pending' },
    },
    { upsert: true, new: true, lean: true }
  );

  console.log('[telegram] DB user synced', {
    telegramId: id,
    username: user?.username,
    phone: user?.phoneNumber ? '(set)' : '(empty)',
  });

  return user;
}

function isRegistered(user) {
  return user?.registrationStatus === 'registered';
}

async function startRegistration({ telegramId, username, firstName }) {
  const id = normalizeTelegramId(telegramId);

  const existing = await findByTelegramId(id);
  if (isRegistered(existing)) {
    return { ok: false, reason: 'already_registered', user: existing };
  }

  const user = await TelegramUserModel.findOneAndUpdate(
    { telegramId: id },
    {
      $set: {
        username: normalizeUsername(username),
        firstName: firstName ? String(firstName).trim() : '',
        registrationStatus: 'pending',
      },
      $setOnInsert: { telegramId: id },
    },
    { upsert: true, new: true, lean: true }
  );

  return { ok: true, user };
}

async function completeRegistration({
  telegramId,
  phoneNumber,
  firstName,
  lastName,
  username,
}) {
  const id = normalizeTelegramId(telegramId);
  const phone = String(phoneNumber || '').trim();

  if (!phone) {
    return { ok: false, reason: 'invalid_phone' };
  }

  const existing = await findByTelegramId(id);
  if (isRegistered(existing)) {
    return { ok: false, reason: 'already_registered', user: existing };
  }

  let user = await TelegramUserModel.findOneAndUpdate(
    { telegramId: id, registrationStatus: 'pending' },
    {
      $set: {
        phoneNumber: phone,
        registrationStatus: 'registered',
        ...(firstName ? { firstName: String(firstName).trim() } : {}),
        ...(lastName ? { lastName: String(lastName).trim() } : {}),
        ...(username ? { username: normalizeUsername(username) } : {}),
      },
    },
    { new: true, lean: true }
  );
  const isNewRegistration = Boolean(user);

  if (!user && isRegistered(existing)) {
    user = await TelegramUserModel.findOneAndUpdate(
      { telegramId: id },
      {
        $set: {
          phoneNumber: phone,
          ...(firstName ? { firstName: String(firstName).trim() } : {}),
          ...(lastName ? { lastName: String(lastName).trim() } : {}),
          ...(username ? { username: normalizeUsername(username) } : {}),
        },
      },
      { new: true, lean: true }
    );
  }

  if (user) {
    try {
      const { getOrInitProfile } = require('./profileService');
      await getOrInitProfile(String(id), {
        phone: user.phoneNumber,
        displayName: user.firstName || String(user.username || '').replace(/^@/, ''),
      });
      console.log('[telegram] phone saved', {
        telegramId: id,
        phone: user.phoneNumber,
      });
    } catch (err) {
      console.warn('[telegram] profile sync after register failed', err?.message);
    }

    if (isNewRegistration) {
      try {
        const { tryGrantRegistrationBonus } = require('./registrationBonusService');
        await tryGrantRegistrationBonus(String(id));
      } catch (err) {
        console.warn('[registrationBonus] grant after register failed', err?.message);
      }
    }

    return { ok: true, user };
  }

  const current = await findByTelegramId(id);
  if (isRegistered(current)) {
    return { ok: false, reason: 'already_registered', user: current };
  }

  return { ok: false, reason: 'not_pending' };
}

module.exports = {
  findByTelegramId,
  isRegistered,
  startRegistration,
  completeRegistration,
  syncTelegramProfileFromClient,
  normalizeUsername,
};
