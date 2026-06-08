const { mongoose } = require('../config/db');
const { UserProfileModel } = require('../models/UserProfile');
const { creditDepositAsync } = require('../socket/walletManager');
const { recordTransaction } = require('./walletTransactionService');
const settingsService = require('./settingsService');

/** @type {Set<string>} */
const memoryBonusGranted = new Set();

function isDbReady() {
  return mongoose.connection?.readyState === 1;
}

async function tryGrantRegistrationBonus(userId) {
  const key = String(userId || '').trim();
  if (!key) return { ok: false, skipped: 'invalid_user' };

  const settings = await settingsService.getRegistrationBonusSettings();
  if (!settings.registrationBonusEnabled) {
    return { ok: false, skipped: 'disabled' };
  }

  const amount = Math.floor(Number(settings.registrationBonusAmount) || 0);
  if (amount <= 0) {
    return { ok: false, skipped: 'zero_amount' };
  }

  if (isDbReady()) {
    const claimed = await UserProfileModel.findOneAndUpdate(
      { userId: key, registrationBonusReceived: { $ne: true } },
      { $set: { registrationBonusReceived: true } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    if (!claimed) {
      return { ok: false, skipped: 'already_received' };
    }
  } else if (memoryBonusGranted.has(key)) {
    return { ok: false, skipped: 'already_received' };
  } else {
    memoryBonusGranted.add(key);
  }

  const credit = await creditDepositAsync(key, amount, {
    source: 'registration_bonus',
  });

  if (!credit.ok) {
    if (isDbReady()) {
      await UserProfileModel.findOneAndUpdate(
        { userId: key },
        { $set: { registrationBonusReceived: false } }
      );
    } else {
      memoryBonusGranted.delete(key);
    }
    return { ok: false, error: credit.error || 'credit_failed' };
  }

  await recordTransaction(key, {
    type: 'deposit',
    amount,
    channel: 'REGISTRATION_BONUS',
    detail: 'Registration Bonus',
  });

  console.log('[registrationBonus] credited', { userId: key, amount });
  return { ok: true, amount, playWallet: credit.wallet?.play };
}

module.exports = {
  tryGrantRegistrationBonus,
};
