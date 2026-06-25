const { mongoose } = require('../config/db');
const { WithdrawRequestModel } = require('../models/WithdrawRequest');
const { validateWithdrawAmount } = require('./botWithdrawService');
const { recordTransaction } = require('./walletTransactionService');
const { sendTelegramMessage } = require('./telegramBotNotify');
const { broadcastAdmin, getDashboardSnapshotAsync } = require('./adminService');
const userRoleService = require('./userRoleService');
const { isPanelRole } = require('../constants/roles');

const MSG_APPROVED = (amount) =>
  `✅ የ${amount} ብር ወጪዎ በተሳካ ሁኔታ ተጠናቋል።`;

const MSG_REJECTED = '❌ የወጪ ጥያቄዎ ውድቅ ተደርጓል።';

function walletManager() {
  return require('../socket/walletManager');
}

function isDbReady() {
  return mongoose.connection?.readyState === 1;
}

function formatDisplayUser(request = {}) {
  const rawUsername = String(request.telegramUsername || '').trim();
  if (rawUsername) {
    return rawUsername.startsWith('@') ? rawUsername : `@${rawUsername}`;
  }
  const firstName = String(request.telegramFirstName || '').trim();
  if (firstName) return firstName;
  return 'User';
}

function formatStatusLabel(status) {
  const value = String(status || 'pending').toLowerCase();
  if (value === 'approved') return 'Approved';
  if (value === 'rejected') return 'Rejected';
  return 'Pending';
}

function formatWithdrawRequestNotification(request = {}) {
  const amount = Math.max(0, Number(request.amount) || 0);
  const status = formatStatusLabel(request.status);
  return [
    'Withdraw Request Received',
    '',
    `User: ${formatDisplayUser(request)}`,
    `User ID: ${request.userId}`,
    `Amount: ${amount} Birr`,
    `Status: ${status}`,
  ].join('\n');
}

function formatMethodLabel(method) {
  return String(method || '').toLowerCase().includes('cbe')
    ? 'CBE Birr'
    : 'Telebirr';
}

function formatRequestRow(doc) {
  const row = doc?.toObject ? doc.toObject() : doc;
  return {
    id: String(row._id ?? row.id),
    userId: row.userId,
    telegramUsername: row.telegramUsername || '',
    telegramFirstName: row.telegramFirstName || '',
    amount: Number(row.amount) || 0,
    paymentMethod: row.paymentMethod || '',
    paymentMethodLabel: formatMethodLabel(row.paymentMethod),
    phone: row.phone || '',
    accountName: row.accountName || '',
    status: row.status,
    mainWalletAtRequest: Number(row.mainWalletAtRequest) || 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function collectEnvOperatorIds() {
  const ids = new Set();
  const envKeys = [
    'WITHDRAW_ADMIN_CHAT_ID',
    'ADMIN_CHAT_ID',
    'WITHDRAW_NOTIFY_CHAT_ID',
  ];

  for (const key of envKeys) {
    const raw = String(process.env[key] || '').trim();
    if (!raw) continue;
    for (const part of raw.split(',')) {
      const id = part.trim();
      if (id) ids.add(id);
    }
  }

  const bootstrap = String(process.env.BOOTSTRAP_MANAGER_TELEGRAM_ID || '').trim();
  if (bootstrap) ids.add(bootstrap);

  return ids;
}

async function assertWithdrawOperatorAuthorized(telegramId) {
  const parsed = userRoleService.parseTelegramId(telegramId);
  if (!parsed) {
    return { ok: false, error: 'invalid_telegram_id' };
  }

  if (collectEnvOperatorIds().has(String(parsed))) {
    return { ok: true, telegramId: parsed, source: 'env' };
  }

  const login = await userRoleService.resolvePanelLogin(parsed);
  if (login.ok && isPanelRole(login.role)) {
    return { ok: true, telegramId: parsed, role: login.role, source: 'panel' };
  }

  return {
    ok: false,
    error: 'not_authorized',
    message: 'You are not authorized to manage withdraw requests.',
  };
}

async function getWithdrawRequestStats() {
  if (!isDbReady()) {
    return { pending: 0, approved: 0, rejected: 0, total: 0 };
  }

  const [pending, approved, rejected] = await Promise.all([
    WithdrawRequestModel.countDocuments({ status: 'pending' }),
    WithdrawRequestModel.countDocuments({ status: 'approved' }),
    WithdrawRequestModel.countDocuments({ status: 'rejected' }),
  ]);

  return {
    pending,
    approved,
    rejected,
    total: pending + approved + rejected,
  };
}

async function listWithdrawRequests({ status, limit = 100 } = {}) {
  if (!isDbReady()) {
    return { ok: true, requests: [], stats: await getWithdrawRequestStats() };
  }

  const filter = {};
  if (status && ['pending', 'approved', 'rejected'].includes(status)) {
    filter.status = status;
  }

  const rows = await WithdrawRequestModel.find(filter)
    .sort({ createdAt: -1 })
    .limit(Math.min(Number(limit) || 100, 200))
    .lean();

  const stats = await getWithdrawRequestStats();

  return {
    ok: true,
    requests: rows.map(formatRequestRow),
    stats,
  };
}

function resolveInternalApiBase() {
  if (process.env.API_INTERNAL_URL) {
    return String(process.env.API_INTERNAL_URL).replace(/\/$/, '');
  }
  const port = Number(process.env.PORT) || 3001;
  return `http://127.0.0.1:${port}`;
}

async function requestAdminPanelBroadcast() {
  const base = resolveInternalApiBase();
  const token = String(process.env.ADMIN_TOKEN || '').trim();
  if (!token) {
    console.warn('[withdraw] admin HTTP broadcast skipped — ADMIN_TOKEN is not set');
    return false;
  }
  const url = `${base}/api/admin/internal/broadcast-withdraw-requests`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn('[withdraw] admin HTTP broadcast failed', res.status, body);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[withdraw] admin HTTP broadcast error:', err?.message || err);
    return false;
  }
}

async function emitWithdrawRequestsUpdate() {
  const payload = await listWithdrawRequests({ limit: 100 });
  const dashboard = await getDashboardSnapshotAsync();
  const { hasAdminIo } = require('./adminService');

  if (hasAdminIo()) {
    broadcastAdmin('admin:withdrawRequests', payload);
    broadcastAdmin('admin:dashboard', dashboard);
    return { ok: true, via: 'socket' };
  }

  const viaHttp = await requestAdminPanelBroadcast();
  if (viaHttp) {
    return { ok: true, via: 'http' };
  }

  console.warn('[withdraw] admin panel broadcast unavailable');
  return { ok: false, error: 'broadcast_unavailable' };
}

async function notifyUser(userId, text) {
  await sendTelegramMessage(String(userId), text);
}

async function approveWithdrawRequest(requestId) {
  if (!isDbReady()) {
    return { ok: false, error: 'database_unavailable' };
  }

  const id = String(requestId || '').trim();
  if (!id) {
    return { ok: false, error: 'invalid_request_id' };
  }

  const claimed = await WithdrawRequestModel.findOneAndUpdate(
    { _id: id, status: 'pending' },
    { $set: { status: 'approved' } },
    { new: true }
  );

  if (!claimed) {
    return { ok: false, error: 'already_processed' };
  }

  const userId = String(claimed.userId);
  const amount = Number(claimed.amount) || 0;

  const { getWalletBalanceAsync, debitWithdrawAsync } = walletManager();

  const wallet = await getWalletBalanceAsync(userId);
  const validation = validateWithdrawAmount(wallet.mainWallet, amount);

  if (!validation.ok) {
    await WithdrawRequestModel.updateOne(
      { _id: id, status: 'approved' },
      { $set: { status: 'pending' } }
    );
    return {
      ok: false,
      error: validation.error || 'validation_failed',
      message: validation.message,
    };
  }

  const debit = await debitWithdrawAsync(userId, amount);
  if (!debit.ok) {
    await WithdrawRequestModel.updateOne(
      { _id: id, status: 'approved' },
      { $set: { status: 'pending' } }
    );
    return { ok: false, error: debit.error || 'debit_failed' };
  }

  const channel = formatMethodLabel(claimed.paymentMethod).toUpperCase();
  await recordTransaction(userId, {
    type: 'withdraw',
    amount,
    channel,
    detail: `${claimed.accountName} • ${claimed.phone}`,
  });

  await notifyUser(userId, MSG_APPROVED(amount));

  const formatted = formatRequestRow(claimed);
  try {
    const { syncWithdrawBotMessagesForRequest } = require('./withdrawRequestNotifyService');
    await syncWithdrawBotMessagesForRequest(formatted);
  } catch (err) {
    console.warn('[withdraw] bot message sync failed', err?.message || err);
  }

  await emitWithdrawRequestsUpdate();

  return {
    ok: true,
    request: formatted,
    withdrawn: amount,
  };
}

async function rejectWithdrawRequest(requestId) {
  if (!isDbReady()) {
    return { ok: false, error: 'database_unavailable' };
  }

  const id = String(requestId || '').trim();
  if (!id) {
    return { ok: false, error: 'invalid_request_id' };
  }

  const rejected = await WithdrawRequestModel.findOneAndUpdate(
    { _id: id, status: 'pending' },
    { $set: { status: 'rejected' } },
    { new: true }
  );

  if (!rejected) {
    return { ok: false, error: 'already_processed' };
  }

  await notifyUser(String(rejected.userId), MSG_REJECTED);

  const formatted = formatRequestRow(rejected);
  try {
    const { syncWithdrawBotMessagesForRequest } = require('./withdrawRequestNotifyService');
    await syncWithdrawBotMessagesForRequest(formatted);
  } catch (err) {
    console.warn('[withdraw] bot message sync failed', err?.message || err);
  }

  await emitWithdrawRequestsUpdate();

  return {
    ok: true,
    request: formatted,
  };
}

/**
 * Single entry point for admin panel + withdraw bot status changes.
 * @param {string} requestId
 * @param {'approved'|'rejected'} status
 * @param {{ actorTelegramId?: number|string }} [options]
 */
async function updateWithdrawStatus(requestId, status, options = {}) {
  const normalized = String(status || '').toLowerCase();
  if (!['approved', 'rejected'].includes(normalized)) {
    return { ok: false, error: 'invalid_status' };
  }

  if (options.actorTelegramId != null) {
    const auth = await assertWithdrawOperatorAuthorized(options.actorTelegramId);
    if (!auth.ok) return auth;
  }

  if (normalized === 'approved') {
    return approveWithdrawRequest(requestId);
  }
  return rejectWithdrawRequest(requestId);
}

module.exports = {
  listWithdrawRequests,
  getWithdrawRequestStats,
  approveWithdrawRequest,
  rejectWithdrawRequest,
  updateWithdrawStatus,
  assertWithdrawOperatorAuthorized,
  emitWithdrawRequestsUpdate,
  formatRequestRow,
  formatWithdrawRequestNotification,
};
