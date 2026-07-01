const { mongoose } = require('../config/db');
const { WithdrawRequestModel } = require('../models/WithdrawRequest');

const MIN_REMAINING_MAIN = 10;

const MSG_NO_BALANCE =
  'በቂ withdrawable balance የለዎትም።\nDeposit በማድረግ ይጫወቱ!';

const MSG_MIN_REMAINING =
  'ይቅርታ ጥያቄዎን ማስተናገድ አልተቻለም።\nቀሪ ሂሳብ ከ 10 ብር ያነሰ ሊሆን አይችልም።';

const MSG_PENDING_WITHDRAW =
  'You already have a pending withdrawal request. Please wait for admin approval.';

/** @type {object[]} */
const memoryRequests = [];

function walletManager() {
  return require('../socket/walletManager');
}

function isDbReady() {
  return mongoose.connection?.readyState === 1;
}

async function getMainWalletBalance(telegramId) {
  if (!telegramId) return 0;
  const { getWalletBalanceAsync } = walletManager();
  const wallet = await getWalletBalanceAsync(String(telegramId));
  return Math.max(0, Number(wallet.mainWallet) || 0);
}

/**
 * Validate withdraw amount against Main Wallet only (Play Wallet excluded).
 */
function validateWithdrawAmount(mainBalance, amount) {
  const main = Math.max(0, Number(mainBalance) || 0);
  const value = Number(String(amount ?? '').trim().replace(/,/g, ''));

  if (main <= 0) {
    return { ok: false, error: 'no_balance', message: MSG_NO_BALANCE };
  }
  if (!Number.isFinite(value) || value <= 0) {
    return { ok: false, error: 'invalid_amount' };
  }
  if (value > main) {
    return {
      ok: false,
      error: 'insufficient',
      message: MSG_NO_BALANCE,
    };
  }
  if (main - value < MIN_REMAINING_MAIN) {
    return {
      ok: false,
      error: 'min_remaining',
      message: MSG_MIN_REMAINING,
    };
  }

  return {
    ok: true,
    amount: value,
    remaining: main - value,
    mainBalance: main,
  };
}

function isDuplicateKeyError(err) {
  return err?.code === 11000 || /duplicate key/i.test(String(err?.message || ''));
}

async function findPendingWithdrawRequest(userId) {
  const key = String(userId);
  if (isDbReady()) {
    return WithdrawRequestModel.findOne({ userId: key, status: 'pending' })
      .select('_id amount createdAt')
      .lean();
  }
  return (
    memoryRequests.find((row) => row.userId === key && row.status === 'pending') ||
    null
  );
}

async function assertNoPendingWithdrawRequest(userId) {
  const pending = await findPendingWithdrawRequest(userId);
  if (pending) {
    return {
      ok: false,
      error: 'pending_request',
      message: MSG_PENDING_WITHDRAW,
    };
  }
  return { ok: true };
}

async function createWithdrawRequest({
  userId,
  amount,
  paymentMethod,
  phone,
  accountName,
  telegramUsername = '',
  telegramFirstName = '',
  mainWalletAtRequest = 0,
}) {
  const key = String(userId);
  const row = {
    userId: key,
    amount: Math.max(0, Number(amount) || 0),
    paymentMethod: String(paymentMethod || 'telebirr'),
    phone: String(phone || '').trim(),
    accountName: String(accountName || '').trim(),
    status: 'pending',
    telegramUsername,
    telegramFirstName,
    mainWalletAtRequest: Math.max(0, Number(mainWalletAtRequest) || 0),
    createdAt: new Date(),
  };

  if (isDbReady()) {
    try {
      const doc = await WithdrawRequestModel.create(row);
      const request = doc.toObject();
      try {
        const { emitWithdrawRequestsUpdate } = require('./withdrawAdminService');
        void emitWithdrawRequestsUpdate();
      } catch (err) {
        console.warn('[withdraw] admin broadcast failed', err?.message || err);
      }
      try {
        const { notifyWithdrawRequestCreated } = require('./withdrawRequestNotifyService');
        const notifyResult = await notifyWithdrawRequestCreated(request);
        if (!notifyResult?.ok) {
          console.warn('[withdraw] telegram notify result', notifyResult);
        }
      } catch (err) {
        console.warn('[withdraw] telegram notify failed', err?.message || err);
      }
      return { ok: true, request };
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        return {
          ok: false,
          error: 'pending_request',
          message: MSG_PENDING_WITHDRAW,
        };
      }
      throw err;
    }
  }

  if (memoryRequests.some((row) => row.userId === key && row.status === 'pending')) {
    return {
      ok: false,
      error: 'pending_request',
      message: MSG_PENDING_WITHDRAW,
    };
  }

  const mem = { ...row, _id: `mem-wd-${Date.now()}` };
  memoryRequests.unshift(mem);
  try {
    const { notifyWithdrawRequestCreated } = require('./withdrawRequestNotifyService');
    const notifyResult = await notifyWithdrawRequestCreated(mem);
    if (!notifyResult?.ok) {
      console.warn('[withdraw] telegram notify result', notifyResult);
    }
  } catch (err) {
    console.warn('[withdraw] telegram notify failed', err?.message || err);
  }
  return { ok: true, request: mem };
}

function formatAdminWithdrawNotice(request, profile = {}) {
  const { formatWithdrawRequestNotification } = require('./withdrawAdminService');
  return formatWithdrawRequestNotification({
    ...request,
    telegramUsername: request.telegramUsername || profile.username || '',
    telegramFirstName: request.telegramFirstName || profile.firstName || '',
  });
}

async function submitWithdrawRequest(payload) {
  const userRoleService = require('./userRoleService');
  const banCheck = await userRoleService.assertUserNotBanned(payload.userId);
  if (!banCheck.ok && banCheck.banned) {
    return {
      ok: false,
      error: banCheck.error,
      message: banCheck.message,
    };
  }

  const mainBalance = await getMainWalletBalance(payload.userId);
  const validation = validateWithdrawAmount(mainBalance, payload.amount);
  if (!validation.ok) {
    return validation;
  }

  const pendingCheck = await assertNoPendingWithdrawRequest(payload.userId);
  if (!pendingCheck.ok) {
    return pendingCheck;
  }

  const result = await createWithdrawRequest({
    ...payload,
    amount: validation.amount,
    mainWalletAtRequest: mainBalance,
  });

  if (!result.ok) {
    return result;
  }

  return {
    ok: true,
    request: result.request,
    amount: validation.amount,
  };
}

module.exports = {
  MIN_REMAINING_MAIN,
  MSG_NO_BALANCE,
  MSG_MIN_REMAINING,
  MSG_PENDING_WITHDRAW,
  getMainWalletBalance,
  validateWithdrawAmount,
  findPendingWithdrawRequest,
  assertNoPendingWithdrawRequest,
  submitWithdrawRequest,
  formatAdminWithdrawNotice,
};
