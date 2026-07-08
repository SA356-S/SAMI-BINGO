const { mongoose } = require('../config/db');
const { UserProfileModel } = require('../models/UserProfile');
const settingsService = require('./settingsService');

/** @type {Set<string>} */
const memoryBonusClaimed = new Set();

function isDbReady() {
  return mongoose.connection?.readyState === 1;
}

function computeBonusAmount(depositAmount, percent) {
  const deposit = Math.max(0, Number(depositAmount) || 0);
  const pct = Number(percent);
  if (!Number.isFinite(pct) || pct <= 0 || deposit <= 0) return 0;
  return deposit * (pct / 100);
}

function isBonusGloballyDisabled() {
  const settings = settingsService.getFirstDepositBonusSettingsSync();
  if (!settings.firstDepositBonusEnabled) return true;
  const pct = Number(settings.firstDepositBonusPercent);
  return !Number.isFinite(pct) || pct <= 0;
}

function markBonusClaimed(userId) {
  const key = String(userId || '').trim();
  if (key) memoryBonusClaimed.add(key);
}

async function hasFirstDepositBonusBeenClaimed(userId) {
  const key = String(userId || '').trim();
  if (!key) return true;
  if (memoryBonusClaimed.has(key)) return true;

  if (!isDbReady()) return false;

  const profile = await UserProfileModel.findOne(
    { userId: key },
    { firstDepositBonusClaimed: 1 }
  ).lean();
  if (profile?.firstDepositBonusClaimed) {
    memoryBonusClaimed.add(key);
    return true;
  }
  return false;
}

/**
 * Fast gate: return false when bonus logic must not run (already claimed or disabled).
 */
async function shouldAttemptFirstDepositBonus(userId) {
  if (isBonusGloballyDisabled()) return false;
  return !(await hasFirstDepositBonusBeenClaimed(userId));
}

async function tryClaimFirstDepositBonus(userId) {
  const key = String(userId || '').trim();
  if (!key) return { ok: false, skipped: 'invalid_user' };

  if (isBonusGloballyDisabled()) {
    return { ok: false, skipped: 'disabled' };
  }

  const pct = Number(
    settingsService.getFirstDepositBonusSettingsSync().firstDepositBonusPercent
  );

  if (isDbReady()) {
    const claimed = await UserProfileModel.findOneAndUpdate(
      { userId: key, firstDepositBonusClaimed: { $ne: true } },
      { $set: { firstDepositBonusClaimed: true } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    if (!claimed) {
      markBonusClaimed(key);
      return { ok: false, skipped: 'already_claimed' };
    }
  } else if (memoryBonusClaimed.has(key)) {
    return { ok: false, skipped: 'already_claimed' };
  } else {
    memoryBonusClaimed.add(key);
  }

  return { ok: true, bonusPercent: pct };
}

async function rollbackFirstDepositBonusClaim(userId) {
  const key = String(userId || '').trim();
  if (!key) return;

  memoryBonusClaimed.delete(key);

  if (isDbReady()) {
    await UserProfileModel.findOneAndUpdate(
      { userId: key },
      { $set: { firstDepositBonusClaimed: false } }
    );
  }
}

/**
 * Resolve wallet credit for an approved deposit, applying one-time first deposit bonus when eligible.
 * @param {string} userId
 * @param {number} depositAmount - verified deposit amount (pre-bonus)
 * @returns {Promise<{ creditedAmount: number, bonusAmount: number, bonusApplied: boolean, bonusPercent: number }>}
 */
async function resolveFirstDepositWalletCredit(userId, depositAmount) {
  const deposit = Math.max(0, Number(depositAmount) || 0);
  const base = {
    creditedAmount: deposit,
    bonusAmount: 0,
    bonusApplied: false,
    bonusPercent: 0,
  };

  const pct = Number(
    settingsService.getFirstDepositBonusSettingsSync().firstDepositBonusPercent
  );
  const bonusAmount = computeBonusAmount(deposit, pct);
  if (bonusAmount <= 0) return base;

  const claim = await tryClaimFirstDepositBonus(userId);
  if (!claim.ok) return base;

  markBonusClaimed(userId);

  return {
    creditedAmount: deposit + bonusAmount,
    bonusAmount,
    bonusApplied: true,
    bonusPercent: pct,
  };
}

module.exports = {
  shouldAttemptFirstDepositBonus,
  resolveFirstDepositWalletCredit,
  rollbackFirstDepositBonusClaim,
};
