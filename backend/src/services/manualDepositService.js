/**
 * Manual deposit requests submitted from the Telegram bot.
 * Completely separate from Telebirr/CBE automatic qbirr verification.
 * Never calls qbirr. Never credits the wallet until an admin approves.
 */

const { mongoose } = require('../config/db');
const { ManualDepositModel } = require('../models/ManualDeposit');
const { creditDepositAsync } = require('../socket/walletManager');
const { recordTransaction } = require('./walletTransactionService');
const {
  sendTelegramMessage,
  downloadTelegramFileById,
} = require('./telegramBotNotify');
const userRoleService = require('./userRoleService');
const { isPanelRole } = require('../constants/roles');

const MSG_APPROVED = (amount) =>
  [
    '✅ የ Manual Deposit ጥያቄዎ ተፀድቋል።',
    '',
    `መጠን: ${amount} ETB`,
    'Play Walletዎ ተሞልቷል።',
    '',
    `✅ Your manual deposit of ${amount} ETB was approved.`,
  ].join('\n');

const MSG_REJECTED = [
  '❌ የ Manual Deposit ጥያቄዎ ውድቅ ተደርጓል።',
  '',
  '❌ Your manual deposit was rejected.',
].join('\n');

function isDbReady() {
  return mongoose.connection?.readyState === 1;
}

function toAmount(value) {
  const amount = Number(String(value ?? '').replace(/,/g, '').trim());
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return Math.round(amount * 100) / 100;
}

function parseAmountFromText(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const labeled = text.match(
    /(?:amount|መጠን|birr|etb)[^\d]{0,12}(\d+(?:[.,]\d{1,2})?)/i
  );
  if (labeled?.[1]) {
    const amount = toAmount(labeled[1].replace(',', '.'));
    if (amount != null) return amount;
  }
  const suffixed = text.match(/(\d+(?:[.,]\d{1,2})?)\s*(?:ETB|Birr|ብር)/i);
  if (suffixed?.[1]) {
    const amount = toAmount(suffixed[1].replace(',', '.'));
    if (amount != null) return amount;
  }
  if (/^\d+(?:[.,]\d{1,2})?$/.test(text)) {
    return toAmount(text.replace(',', '.'));
  }
  return null;
}

function formatDisplayName(row = {}) {
  const username = String(row.telegramUsername || '').trim();
  if (username) return username.startsWith('@') ? username : `@${username}`;
  const first = String(row.telegramFirstName || '').trim();
  const last = String(row.telegramLastName || '').trim();
  const name = [first, last].filter(Boolean).join(' ');
  return name || 'User';
}

function formatRequestRow(doc) {
  const row = doc?.toObject ? doc.toObject() : doc;
  const id = String(row._id ?? row.id);
  return {
    id,
    userId: row.userId,
    telegramUsername: row.telegramUsername || '',
    telegramFirstName: row.telegramFirstName || '',
    telegramLastName: row.telegramLastName || '',
    displayName: formatDisplayName(row),
    submittedAmount: row.submittedAmount == null ? null : Number(row.submittedAmount) || null,
    approvedAmount: row.approvedAmount == null ? null : Number(row.approvedAmount) || null,
    amount: row.approvedAmount != null
      ? Number(row.approvedAmount) || null
      : row.submittedAmount != null
        ? Number(row.submittedAmount) || null
        : null,
    photoFileId: row.photoFileId || '',
    photoWidth: row.photoWidth ?? null,
    photoHeight: row.photoHeight ?? null,
    photoCaption: row.photoCaption || '',
    status: row.status,
    walletCredited: Boolean(row.walletCredited),
    screenshotUrl: `/api/admin/manual-deposits/${id}/screenshot`,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    reviewedAt: row.reviewedAt || null,
    reviewedByTelegramId: row.reviewedByTelegramId || '',
    reviewedByRole: row.reviewedByRole || '',
  };
}

function isValidObjectId(id) {
  return /^[a-fA-F0-9]{24}$/.test(String(id || '').trim());
}

async function defaultCreate(doc) {
  const created = await ManualDepositModel.create(doc);
  return created.toObject ? created.toObject() : created;
}

async function defaultFindPendingByUser(userId) {
  return ManualDepositModel.findOne({ userId: String(userId), status: 'pending' }).lean();
}

async function defaultClaimApprove(id, set) {
  return ManualDepositModel.findOneAndUpdate(
    { _id: id, status: 'pending', walletCredited: { $ne: true } },
    { $set: set },
    { new: true }
  );
}

async function defaultRevertToPending(id) {
  return ManualDepositModel.findOneAndUpdate(
    { _id: id, status: 'approved', walletCredited: { $ne: true } },
    {
      $set: { status: 'pending', approvedAmount: null },
      $unset: {
        reviewedAt: 1,
        reviewedByTelegramId: 1,
        reviewedByRole: 1,
      },
    },
    { new: true }
  );
}

async function defaultMarkWalletCredited(id) {
  return ManualDepositModel.findOneAndUpdate(
    { _id: id, status: 'approved', walletCredited: { $ne: true } },
    { $set: { walletCredited: true } },
    { new: true }
  );
}

async function defaultClaimReject(id, set) {
  return ManualDepositModel.findOneAndUpdate(
    { _id: id, status: 'pending' },
    { $set: set },
    { new: true }
  );
}

async function defaultFindById(id) {
  return ManualDepositModel.findById(id).lean();
}

function createDefaultDeps() {
  return {
    create: defaultCreate,
    findPendingByUser: defaultFindPendingByUser,
    claimApprove: defaultClaimApprove,
    revertToPending: defaultRevertToPending,
    markWalletCredited: defaultMarkWalletCredited,
    claimReject: defaultClaimReject,
    findById: defaultFindById,
    creditWallet: creditDepositAsync,
    recordTx: recordTransaction,
    notifyUser: sendTelegramMessage,
    downloadFile: downloadTelegramFileById,
  };
}

async function submitManualDeposit(params = {}, deps = createDefaultDeps()) {
  const userId = String(params.userId || '').trim();
  if (!userId) {
    return { ok: false, error: 'user_id_required' };
  }

  const photoFileId = String(params.photoFileId || '').trim();
  if (!photoFileId) {
    return { ok: false, error: 'photo_required' };
  }

  if (typeof deps.findPendingByUser !== 'function' && !isDbReady()) {
    return { ok: false, error: 'database_unavailable' };
  }

  const existing = await deps.findPendingByUser(userId);
  if (existing) {
    return {
      ok: false,
      error: 'already_pending',
      request: formatRequestRow(existing),
    };
  }

  const submittedAmount = toAmount(params.submittedAmount);

  let created;
  try {
    created = await deps.create({
      userId,
      telegramUsername: String(params.telegramUsername || '').trim(),
      telegramFirstName: String(params.telegramFirstName || '').trim(),
      telegramLastName: String(params.telegramLastName || '').trim(),
      submittedAmount,
      approvedAmount: null,
      photoFileId,
      photoFileUniqueId: String(params.photoFileUniqueId || '').trim(),
      photoWidth: Number.isFinite(Number(params.photoWidth)) ? Number(params.photoWidth) : null,
      photoHeight: Number.isFinite(Number(params.photoHeight)) ? Number(params.photoHeight) : null,
      photoCaption: String(params.photoCaption || '').trim().slice(0, 1024),
      status: 'pending',
      walletCredited: false,
    });
  } catch (err) {
    if (err?.code === 11000) {
      const pending = await deps.findPendingByUser(userId);
      return {
        ok: false,
        error: 'already_pending',
        request: pending ? formatRequestRow(pending) : undefined,
      };
    }
    throw err;
  }

  return { ok: true, request: formatRequestRow(created) };
}

async function getManualDepositStats(Model = ManualDepositModel) {
  if (!isDbReady()) {
    return { pending: 0, approved: 0, rejected: 0, total: 0 };
  }

  const [pending, approved, rejected] = await Promise.all([
    Model.countDocuments({ status: 'pending' }),
    Model.countDocuments({ status: 'approved' }),
    Model.countDocuments({ status: 'rejected' }),
  ]);

  return {
    pending,
    approved,
    rejected,
    total: pending + approved + rejected,
  };
}

async function listManualDeposits({ status, limit = 100 } = {}) {
  if (!isDbReady()) {
    return { ok: true, requests: [], stats: await getManualDepositStats() };
  }

  const filter = {};
  if (status && ['pending', 'approved', 'rejected'].includes(status)) {
    filter.status = status;
  }

  const rows = await ManualDepositModel.find(filter)
    .sort({ createdAt: -1 })
    .limit(Math.min(Number(limit) || 100, 200))
    .lean();

  return {
    ok: true,
    requests: rows.map(formatRequestRow),
    stats: await getManualDepositStats(),
  };
}

async function assertOperatorAuthorized(telegramId) {
  const parsed = userRoleService.parseTelegramId(telegramId);
  if (!parsed) {
    return { ok: false, error: 'invalid_telegram_id' };
  }

  const login = await userRoleService.resolvePanelLogin(parsed);
  if (login.ok && isPanelRole(login.role)) {
    return { ok: true, telegramId: parsed, role: login.role };
  }

  return {
    ok: false,
    error: 'not_authorized',
    message: 'You are not authorized to manage manual deposits.',
  };
}

async function approveManualDeposit(requestId, options = {}, deps = createDefaultDeps()) {
  const id = String(requestId || '').trim();
  if (!id) {
    return { ok: false, error: 'invalid_request_id' };
  }

  const approvedAmount = toAmount(options.amount);
  if (approvedAmount == null) {
    return {
      ok: false,
      error: 'amount_required',
      message: 'Enter the verified amount to credit.',
    };
  }

  const actorTelegramId = options.actorTelegramId != null
    ? String(options.actorTelegramId)
    : '';
  const actorRole = String(options.actorRole || '').trim();

  const claimed = await deps.claimApprove(id, {
    status: 'approved',
    approvedAmount,
    walletCredited: false,
    reviewedAt: new Date(),
    reviewedByTelegramId: actorTelegramId,
    reviewedByRole: actorRole,
  });

  if (!claimed) {
    return { ok: false, error: 'already_processed' };
  }

  const userId = String(claimed.userId);
  const credit = await deps.creditWallet(userId, approvedAmount);
  if (!credit?.ok) {
    await deps.revertToPending(id);
    return {
      ok: false,
      error: credit?.error || 'wallet_credit_failed',
      message: 'Wallet credit failed. The request is still pending.',
    };
  }

  await deps.markWalletCredited(id);

  await deps.recordTx(userId, {
    type: 'deposit',
    amount: approvedAmount,
    channel: 'MANUAL',
    detail: `Manual deposit ${id}`,
    reference: `MD-${id}`,
  });

  await deps.notifyUser(userId, MSG_APPROVED(approvedAmount)).catch((err) => {
    console.warn('[manual-deposit] approve notify failed', err?.message || err);
  });

  const updated = (await deps.findById?.(id)) || claimed;
  updated.walletCredited = true;
  updated.status = 'approved';
  updated.approvedAmount = approvedAmount;

  return {
    ok: true,
    request: formatRequestRow(updated),
    credited: approvedAmount,
  };
}

async function rejectManualDeposit(requestId, options = {}, deps = createDefaultDeps()) {
  const id = String(requestId || '').trim();
  if (!id) {
    return { ok: false, error: 'invalid_request_id' };
  }

  const rejected = await deps.claimReject(id, {
    status: 'rejected',
    reviewedAt: new Date(),
    reviewedByTelegramId:
      options.actorTelegramId != null ? String(options.actorTelegramId) : '',
    reviewedByRole: String(options.actorRole || '').trim(),
  });

  if (!rejected) {
    return { ok: false, error: 'already_processed' };
  }

  await deps.notifyUser(String(rejected.userId), MSG_REJECTED).catch((err) => {
    console.warn('[manual-deposit] reject notify failed', err?.message || err);
  });

  return {
    ok: true,
    request: formatRequestRow(rejected),
  };
}

async function getManualDepositScreenshot(requestId, deps = createDefaultDeps()) {
  const id = String(requestId || '').trim();
  if (!id) {
    return { ok: false, error: 'invalid_request_id' };
  }

  const row = await deps.findById(id);
  if (!row) {
    return { ok: false, error: 'not_found' };
  }

  const fileId = String(row.photoFileId || '').trim();
  if (!fileId) {
    return { ok: false, error: 'photo_missing' };
  }

  const file = await deps.downloadFile(fileId);
  if (!file?.ok || !file.buffer) {
    return { ok: false, error: file?.error || 'download_failed' };
  }

  return {
    ok: true,
    buffer: file.buffer,
    contentType: file.contentType || 'image/jpeg',
  };
}

module.exports = {
  submitManualDeposit,
  listManualDeposits,
  getManualDepositStats,
  approveManualDeposit,
  rejectManualDeposit,
  getManualDepositScreenshot,
  assertOperatorAuthorized,
  formatRequestRow,
  parseAmountFromText,
  toAmount,
  formatDisplayName,
  isValidObjectId,
  createDefaultDeps,
  MSG_APPROVED,
  MSG_REJECTED,
};
