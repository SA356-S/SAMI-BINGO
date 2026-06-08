const { mongoose } = require('../config/db');
const { ReferralModel } = require('../models/Referral');
const { UserProfileModel } = require('../models/UserProfile');

const BOT_USERNAME = String(process.env.REFERRAL_BOT_USERNAME || 'edilbingo7_bot')
  .replace(/^@/, '')
  .trim();

/** @type {Map<string, object>} */
const memoryReferrals = new Map();

function isDbReady() {
  return mongoose.connection?.readyState === 1;
}

function normalizeCode(code) {
  return String(code || '').trim();
}

function profileService() {
  return require('./profileService');
}

/**
 * Unique referral code per user — Telegram numeric user id (matches reference UI).
 */
async function getOrCreateReferralCode(userId) {
  const key = String(userId || '').trim();
  if (!key) return '';

  const { getOrInitProfile, saveProfile } = profileService();
  const profile = await getOrInitProfile(key);

  if (profile.inviteCode && String(profile.inviteCode).trim()) {
    return String(profile.inviteCode).trim();
  }

  profile.inviteCode = key;
  await saveProfile(profile);
  return key;
}

function buildReferralLink(referralCode) {
  const code = normalizeCode(referralCode);
  if (!code) return `https://t.me/${BOT_USERNAME}`;
  return `https://t.me/${BOT_USERNAME}?start=${encodeURIComponent(code)}`;
}

async function findReferrerByCode(code) {
  const normalized = normalizeCode(code);
  if (!normalized) return null;

  if (isDbReady()) {
    const byUserId = await UserProfileModel.findOne({ userId: normalized }).lean();
    if (byUserId) return byUserId;

    const byInviteCode = await UserProfileModel.findOne({
      inviteCode: normalized,
    }).lean();
    if (byInviteCode) return byInviteCode;

    if (/^\d+$/.test(normalized)) {
      return { userId: normalized, inviteCode: normalized, totalInvited: 0 };
    }
    return null;
  }

  const { getOrInitProfile } = profileService();
  if (/^\d+$/.test(normalized)) {
    const profile = await getOrInitProfile(normalized).catch(() => null);
    return profile || { userId: normalized, inviteCode: normalized, totalInvited: 0 };
  }
  return null;
}

async function hasExistingReferral(referredUserId) {
  const key = String(referredUserId);

  if (isDbReady()) {
    const existing = await ReferralModel.findOne({ referredUserId: key }).lean();
    if (existing) return true;

    const profile = await UserProfileModel.findOne({ userId: key }).lean();
    return Boolean(profile?.referredBy);
  }

  return memoryReferrals.has(key);
}

async function incrementReferrerInviteCount(referrerUserId) {
  const { getOrInitProfile, saveProfile } = profileService();
  const profile = await getOrInitProfile(String(referrerUserId));
  profile.totalInvited = Number(profile.totalInvited || 0) + 1;
  await saveProfile(profile);
  return profile.totalInvited;
}

/**
 * Record referral once. Prevents self-referrals and duplicate registrations.
 */
async function tryRecordReferral(referredUserId, referralCode) {
  const referredKey = String(referredUserId || '').trim();
  const code = normalizeCode(referralCode);
  if (!referredKey || !code) {
    return { ok: false, reason: 'missing_data' };
  }

  if (code === referredKey) {
    return { ok: false, reason: 'self_referral' };
  }

  const referrer = await findReferrerByCode(code);
  if (!referrer) {
    return { ok: false, reason: 'invalid_code' };
  }

  const referrerId = String(referrer.userId);
  if (referrerId === referredKey) {
    return { ok: false, reason: 'self_referral' };
  }

  if (await hasExistingReferral(referredKey)) {
    return { ok: false, reason: 'already_referred' };
  }

  const { getOrInitProfile, saveProfile } = profileService();
  const referredProfile = await getOrInitProfile(referredKey);
  if (referredProfile.referredBy) {
    return { ok: false, reason: 'already_referred' };
  }

  if (isDbReady()) {
    try {
      await ReferralModel.create({
        referrerUserId: referrerId,
        referredUserId: referredKey,
        referralCode: code,
        joinedAt: new Date(),
      });
    } catch (err) {
      if (err?.code === 11000) {
        return { ok: false, reason: 'already_referred' };
      }
      throw err;
    }
  } else {
    memoryReferrals.set(referredKey, {
      referrerUserId: referrerId,
      referredUserId: referredKey,
      referralCode: code,
      joinedAt: new Date(),
    });
  }

  referredProfile.referredBy = referrerId;
  await saveProfile(referredProfile);
  const totalInvited = await incrementReferrerInviteCount(referrerId);

  return {
    ok: true,
    referrerUserId: referrerId,
    referredUserId: referredKey,
    totalInvited,
  };
}

async function getReferralStats(userId) {
  const key = String(userId || '').trim();
  if (!key) {
    return { totalInvited: 0, referrals: [] };
  }

  const { getOrInitProfile } = profileService();
  const profile = await getOrInitProfile(key);

  if (!isDbReady()) {
    const referrals = [...memoryReferrals.values()].filter(
      (r) => String(r.referrerUserId) === key
    );
    return {
      totalInvited: Number(profile.totalInvited || referrals.length),
      referrals: referrals.map((r) => ({
        referredUserId: r.referredUserId,
        joinedAt: r.joinedAt,
      })),
    };
  }

  const referrals = await ReferralModel.find({ referrerUserId: key })
    .sort({ joinedAt: -1 })
    .limit(100)
    .lean();

  return {
    totalInvited: Number(profile.totalInvited || referrals.length),
    referrals: referrals.map((r) => ({
      referredUserId: r.referredUserId,
      joinedAt: r.joinedAt,
    })),
  };
}

async function getInvitePayload(userId) {
  const code = await getOrCreateReferralCode(userId);
  const link = buildReferralLink(code);
  const stats = await getReferralStats(userId);

  return {
    referralCode: code,
    referralLink: link,
    totalInvited: stats.totalInvited,
  };
}

async function processStartReferral(ctx) {
  const referredUserId = ctx.from?.id;
  const payload = normalizeCode(ctx.startPayload ?? ctx.payload ?? '');
  if (!referredUserId || !payload) return null;
  return tryRecordReferral(String(referredUserId), payload);
}

module.exports = {
  BOT_USERNAME,
  getOrCreateReferralCode,
  buildReferralLink,
  tryRecordReferral,
  getReferralStats,
  getInvitePayload,
  processStartReferral,
};
