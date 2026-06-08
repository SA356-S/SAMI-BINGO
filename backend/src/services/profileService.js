const { mongoose } = require('../config/db');
const { UserProfileModel } = require('../models/UserProfile');
const { getWalletBalance } = require('../socket/walletManager');
const { loadStats } = require('./statsService');
const {
  findByTelegramId,
  syncTelegramProfileFromClient,
} = require('./telegramUserService');

/** @type {Map<string, object>} */
const memoryProfiles = new Map();

function isDbReady() {
  return mongoose.connection?.readyState === 1;
}

function isPlaceholderDisplayName(value) {
  const v = String(value || '').trim().toLowerCase();
  if (!v) return true;
  return (
    v === 'dev-local-player' ||
    v === 'dev local player' ||
    v.includes('dev-local') ||
    v === 'tewdaj' ||
    v === 'player'
  );
}

function resolveDisplayUsername(userId, extras = {}, telegramRow = null, profile = null) {
  const rawUsername = extras.username ?? telegramRow?.username;
  if (rawUsername) {
    const bare = String(rawUsername).replace(/^@/, '').trim();
    if (bare && !isPlaceholderDisplayName(bare)) return `@${bare}`;
  }

  const profileName =
    profile?.displayName && !isPlaceholderDisplayName(profile.displayName)
      ? profile.displayName
      : '';

  const first =
    extras.firstName ??
    (extras.displayName && !isPlaceholderDisplayName(extras.displayName)
      ? extras.displayName
      : null) ??
    telegramRow?.firstName ??
    profileName ??
    '';
  if (first && String(first).trim()) return String(first).trim();

  const key = String(userId || '');
  if (/^\d+$/.test(key)) return `User ${key}`;
  return 'Player';
}

function profileInitial(username) {
  const raw = String(username).replace(/^@/, '');
  return (raw.charAt(0) || 'P').toUpperCase();
}

function defaultProfile(userId, extras = {}) {
  const key = String(userId);
  return {
    userId: key,
    phone: extras.phone ? String(extras.phone) : '',
    verified: extras.verified !== false,
    displayName: extras.displayName ?? (/^\d+$/.test(key) ? '' : key),
    soundEffectsEnabled: extras.soundEffectsEnabled !== false,
    totalInvited: 0,
    totalEarned: 0,
    inviteCode: key.toUpperCase().slice(0, 8),
    referredBy: extras.referredBy ?? extras.invitedBy ?? '',
  };
}

async function getOrInitProfile(userId, extras = {}) {
  const key = String(userId);
  const phoneFromExtras = extras.phone ?? extras.telegramPhone;

  if (isDbReady()) {
    let doc = await UserProfileModel.findOneAndUpdate(
      { userId: key },
      {
        $setOnInsert: defaultProfile(key, extras),
      },
      { upsert: true, new: true, lean: true }
    );

    const updates = {};
    if (phoneFromExtras) updates.phone = String(phoneFromExtras);
    if (extras.displayName) updates.displayName = String(extras.displayName);

    if (Object.keys(updates).length > 0) {
      doc = await UserProfileModel.findOneAndUpdate(
        { userId: key },
        { $set: updates },
        { new: true, lean: true }
      );
    }

    return doc;
  }

  if (!memoryProfiles.has(key)) {
    memoryProfiles.set(key, defaultProfile(key, extras));
  } else {
    const p = memoryProfiles.get(key);
    if (phoneFromExtras) p.phone = String(phoneFromExtras);
    if (extras.displayName) p.displayName = String(extras.displayName);
  }

  return memoryProfiles.get(key);
}

async function saveProfile(profile) {
  const key = String(profile.userId);
  if (isDbReady()) {
    await UserProfileModel.findOneAndUpdate(
      { userId: key },
      { $set: profile },
      { upsert: true }
    );
  } else {
    memoryProfiles.set(key, { ...profile });
  }
}

async function processReferral(newUserId, inviteCodeOrReferrer) {
  if (!inviteCodeOrReferrer) return;
  const { tryRecordReferral } = require('./referralService');
  await tryRecordReferral(newUserId, inviteCodeOrReferrer);
}

async function addEarnings(userId, amount) {
  const value = Math.max(0, Number(amount) || 0);
  if (value <= 0) return;
  const profile = await getOrInitProfile(userId);
  profile.totalEarned = Number(profile.totalEarned || 0) + value;
  await saveProfile(profile);
}

async function setSoundEffects(userId, enabled) {
  const profile = await getOrInitProfile(userId);
  profile.soundEffectsEnabled = Boolean(enabled);
  await saveProfile(profile);
  return profile.soundEffectsEnabled;
}

async function resolveTelegramExtras(userId, extras = {}) {
  const key = String(userId);
  let telegramRow = null;

  if (isDbReady() && /^\d+$/.test(key)) {
    try {
      telegramRow = await findByTelegramId(key);
    } catch (err) {
      console.warn('[profile] telegram user lookup failed', key, err?.message);
    }
  }

  const displayName =
    extras.displayName ??
    extras.firstName ??
    telegramRow?.firstName ??
    (telegramRow?.username
      ? String(telegramRow.username).replace(/^@/, '')
      : null);

  const phone =
    extras.phone ?? extras.telegramPhone ?? telegramRow?.phoneNumber ?? '';

  const verified =
    extras.verified !== undefined
      ? extras.verified !== false
      : Boolean(
          telegramRow && telegramRow.registrationStatus === 'registered'
        );

  return {
    displayName: displayName ? String(displayName).trim() : '',
    phone: phone ? String(phone).trim() : '',
    verified,
    telegramRow,
  };
}

async function syncClientTelegramIdentity(userId, extras = {}) {
  const key = String(userId);
  if (!/^\d+$/.test(key)) return null;

  return syncTelegramProfileFromClient({
    telegramId: extras.telegramId ?? key,
    username: extras.username,
    firstName: extras.firstName ?? extras.displayName,
    lastName: extras.lastName,
  });
}

async function getProfileData(userId, extras = {}) {
  const key = String(userId);
  await syncClientTelegramIdentity(key, extras);
  const telegramExtras = await resolveTelegramExtras(key, extras);

  await processReferral(key, extras.inviteCode ?? extras.referredBy ?? extras.invitedBy);

  const profile = await getOrInitProfile(key, {
    ...extras,
    displayName: telegramExtras.displayName || extras.displayName,
    phone: telegramExtras.phone || extras.phone,
  });

  if (telegramExtras.phone && profile.phone !== telegramExtras.phone) {
    profile.phone = telegramExtras.phone;
    await saveProfile(profile);
  }

  const stats = await loadStats(key);
  const wallet = getWalletBalance(key);

  const username = resolveDisplayUsername(
    key,
    extras,
    telegramExtras.telegramRow,
    profile
  );
  const firstName =
    extras.firstName ??
    telegramExtras.telegramRow?.firstName ??
    telegramExtras.displayName ??
    profile.displayName ??
    '';

  return {
    ok: true,
    userId: key,
    telegramId: /^\d+$/.test(key) ? key : null,
    username,
    firstName: firstName ? String(firstName).trim() : '',
    initial: profileInitial(username),
    verified: telegramExtras.verified,
    phone: telegramExtras.phone || profile.phone || '',
    mainWallet: wallet.mainWallet,
    playWallet: wallet.playWallet,
    totalWalletBalance: wallet.totalWalletBalance,
    gamesPlayed: stats.gamesPlayed,
    gameWin: stats.wins,
    totalWins: stats.wins,
    totalInvite: Number(profile.totalInvited || 0),
    totalEarned: Number(profile.totalEarned || 0),
    soundEffectsEnabled: profile.soundEffectsEnabled !== false,
    inviteCode: profile.inviteCode || key,
  };
}

module.exports = {
  getOrInitProfile,
  saveProfile,
  getProfileData,
  setSoundEffects,
  addEarnings,
  processReferral,
  resolveTelegramExtras,
  syncClientTelegramIdentity,
  resolveDisplayUsername,
};
