const { sendTelegramMessage } = require('./telegramBotNotify');
const { emitWalletSnapshot } = require('../socket/walletManager');
const { getWalletPageData } = require('./walletTransactionService');

function socketBelongsToUser(socket, userId) {
  const key = String(userId || '').trim();
  if (!key) return false;

  const candidates = [
    socket.data?.userId,
    socket.data?.telegramUserId,
    socket.handshake?.auth?.userId,
    socket.handshake?.auth?.telegramId,
    socket.handshake?.auth?.telegramUserId,
  ];

  return candidates.some(
    (candidate) => candidate != null && String(candidate).trim() === key
  );
}

function formatAdminBalanceMessage(amount, wallet, note) {
  const credited = Math.max(0, Number(amount) || 0);
  const play = Math.max(0, Number(wallet?.play) || 0);
  const lines = [
    '✅ ተቀማጭ ገንዘብ ተጨመረ',
    '',
    `መጠን: ${credited} ETB`,
    `Play Wallet: ${play} ETB`,
  ];
  const detail = String(note || '').trim();
  if (detail) {
    lines.push('', detail);
  }
  return lines.join('\n');
}

async function pushWalletSocketUpdate(userId, wallet) {
  const { hasAdminIo, getAdminIo } = require('./adminService');
  if (!hasAdminIo() || !wallet) return;

  const io = getAdminIo();
  const key = String(userId).trim();
  if (!key) return;

  const targets = [];
  for (const socket of io.sockets.sockets.values()) {
    if (socketBelongsToUser(socket, key)) {
      targets.push(socket);
    }
  }

  if (!targets.length) return;

  let page = null;
  try {
    page = await getWalletPageData(key);
  } catch (err) {
    console.warn('[admin-balance-notify] wallet page load failed', {
      userId: key,
      error: err?.message || err,
    });
  }

  for (const socket of targets) {
    emitWalletSnapshot(socket, wallet);
    if (page) {
      socket.emit('wallet:page', page);
    }
  }
}

/**
 * Notify exactly one user after an admin balance credit.
 * Uses a private Telegram DM and per-socket wallet events — never broadcast.
 */
async function notifyAdminBalanceCredit({ userId, amount, wallet, note }) {
  const key = String(userId || '').trim();
  if (!key) {
    return { ok: false, error: 'user_id_required' };
  }

  const text = formatAdminBalanceMessage(amount, wallet, note);
  const telegramSent = await sendTelegramMessage(key, text);
  await pushWalletSocketUpdate(key, wallet);

  return { ok: true, telegramSent };
}

module.exports = { notifyAdminBalanceCredit };
