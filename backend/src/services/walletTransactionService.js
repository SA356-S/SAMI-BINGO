const { mongoose } = require('../config/db');
const { WalletTransactionModel } = require('../models/WalletTransaction');
const {
  getOrInitProfile,
  saveProfile,
  resolveTelegramExtras,
  syncClientTelegramIdentity,
} = require('./profileService');
const { ensureWalletLoaded, getOrInitWallet, toSnapshot } = require('../socket/walletManager');
/** @type {object[]} */
const memoryTransactions = [];

const ID_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function isDbReady() {
  return mongoose.connection?.readyState === 1;
}

function generateReference() {
  let ref = '';
  for (let i = 0; i < 10; i += 1) {
    ref += ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)];
  }
  return ref;
}

function formatDisplayDate(date) {
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatTransactionRow(row) {
  const isWithdraw = row.type === 'withdraw';
  const amount = Math.abs(Number(row.amount) || 0);

  return {
    id: String(row._id ?? row.id),
    type: isWithdraw ? 'withdraw' : 'deposit',
    title: isWithdraw ? 'WITHDRAW COMPLETED' : 'DEPOSIT APPROVED',
    detail: isWithdraw
      ? `VIA: ${row.channel || 'TELE'}`
      : `REF: ${row.reference || row.detail || '—'}`,
    date: formatDisplayDate(row.createdAt ?? row.date ?? Date.now()),
    amount: isWithdraw ? -amount : amount,
  };
}

async function getWalletUserProfile(userId, extras = {}) {
  return getOrInitProfile(userId, extras);
}

async function recordTransaction(userId, { type, amount, reference, channel, detail }) {
  const key = String(userId);
  const value = Math.abs(Number(amount) || 0);
  if (value <= 0) return null;

  const row = {
    userId: key,
    type: type === 'withdraw' ? 'withdraw' : 'deposit',
    amount: value,
    reference: reference || generateReference(),
    channel: channel || 'TELE',
    detail: detail || '',
    createdAt: new Date(),
  };

  if (isDbReady()) {
    const doc = await WalletTransactionModel.create(row);
    return doc.toObject();
  }

  const mem = { ...row, id: `mem-${Date.now()}-${memoryTransactions.length}` };
  memoryTransactions.unshift(mem);
  return mem;
}

async function listTransactions(userId, limit = 50) {
  const key = String(userId);

  if (isDbReady()) {
    const rows = await WalletTransactionModel.find({ userId: key })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    return rows.map(formatTransactionRow);
  }

  return memoryTransactions
    .filter((r) => String(r.userId) === key)
    .slice(0, limit)
    .map(formatTransactionRow);
}

async function getWalletPageData(userId, profileExtras = {}) {
  const key = String(userId);
  await syncClientTelegramIdentity(key, profileExtras);
  const telegramExtras = await resolveTelegramExtras(key, profileExtras);

  await ensureWalletLoaded(key);
  const wallet = getOrInitWallet(key);
  const profile = await getWalletUserProfile(key, {
    ...profileExtras,
    phone: telegramExtras.phone || profileExtras.phone,
    displayName: telegramExtras.displayName || profileExtras.displayName,
  });

  if (telegramExtras.phone && profile.phone !== telegramExtras.phone) {
    profile.phone = telegramExtras.phone;
    await saveProfile(profile);
  }

  const transactions = await listTransactions(key);
  const snapshot = toSnapshot(wallet);

  const phone =
    telegramExtras.phone ||
    (profile?.phone && String(profile.phone).length > 0
      ? String(profile.phone).trim()
      : '');

  return {
    ok: true,
    userId: key,
    ...snapshot,
    totalAvailable: snapshot.totalWalletBalance,
    phone,
    verified: telegramExtras.verified,
    transactions,
  };
}

module.exports = {
  getOrInitProfile,
  recordTransaction,
  listTransactions,
  getWalletPageData,
  generateReference,
};
