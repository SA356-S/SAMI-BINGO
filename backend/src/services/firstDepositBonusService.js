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

async function tryClaimFirstDepositBonus(userId) {
  const key = String(userId || '').trim();
  if (!key) return { ok: false, skipped: 'invalid_user' };

  const settings = await settingsService.getFirstDepositBonusSettings();
  if (!settings.firstDepositBonusEnabled) {
    return { ok: false, skipped: 'disabled' };
  }

  const pct = Number(settings.firstDepositBonusPercent);
  if (!Number.isFinite(pct) || pct <= 0) {
    return { ok: false, skipped: 'zero_percent' };
  }

  if (isDbReady()) {
    const claimed = await UserProfileModel.findOneAndUpdate(
      { userId: key, firstDepositBonusClaimed: { $ne: true } },
      { $set: { firstDepositBonusClaimed: true } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    if (!claimed) {
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

  if (isDbReady()) {
    await UserProfileModel.findOneAndUpdate(
      { userId: key },
      { $set: { firstDepositBonusClaimed: false } }
    );
  } else {
    memoryBonusClaimed.delete(key);
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

  const settings = await settingsService.getFirstDepositBonusSettings();
  if (!settings.firstDepositBonusEnabled) return base;

  const pct = Number(settings.firstDepositBonusPercent);
  if (!Number.isFinite(pct) || pct <= 0) return base;

  const bonusAmount = computeBonusAmount(deposit, pct);
  if (bonusAmount <= 0) return base;

  const claim = await tryClaimFirstDepositBonus(userId);
  if (!claim.ok) return base;

  return {
    creditedAmount: deposit + bonusAmount,
    bonusAmount,
    bonusApplied: true,
    bonusPercent: pct,
  };
}

module.exports = {
  resolveFirstDepositWalletCredit,
  rollbackFirstDepositBonusClaim,
};
