import { getSocket } from './socket';
import { resolveServerUrl } from './resolveServerUrl';
import {
  getPlayerUserId,
  getTelegramIdentityPayload,
  buildTelegramIdentityQuery,
  buildTelegramAuthHeaders,
} from './playerIdentity';

const API_BASE = resolveServerUrl();

/** Normalize wallet fields from REST or socket payloads */
export function parseWalletPayload(data = {}) {
  const mainWallet = Math.max(
    0,
    Number(data.mainWallet ?? data.wallets?.main ?? 0) || 0
  );
  const playWallet = Math.max(
    0,
    Number(data.playWallet ?? data.wallets?.play ?? 0) || 0
  );
  const fromServer = Number(data.totalWalletBalance ?? data.wallets?.total);
  const totalWalletBalance = Number.isFinite(fromServer)
    ? Math.max(0, fromServer)
    : mainWallet + playWallet;

  return { mainWallet, playWallet, totalWalletBalance };
}

const EMPTY_WALLET_PAGE = {
  ok: false,
  mainWallet: 0,
  playWallet: 0,
  totalWalletBalance: 0,
  totalAvailable: 0,
  phone: '',
  verified: false,
  transactions: [],
  loadError: true,
  authError: false,
};

function normalizeWalletPage(data = {}) {
  const balances = parseWalletPayload(data);
  return {
    ...balances,
    ok: data.ok !== false,
    totalAvailable: balances.totalWalletBalance,
    phone: data.phone ?? '',
    verified: data.verified !== false,
    transactions: Array.isArray(data.transactions) ? data.transactions : [],
    loadError: false,
  };
}

/**
 * GET /api/wallet — balances, phone, and transaction history.
 */
export async function fetchWalletPage(userId = getPlayerUserId()) {
  const id = userId || getPlayerUserId();
  if (!id) {
    console.error('[wallet] skipped — no Telegram user id');
    return { ...EMPTY_WALLET_PAGE, loadError: true, authError: true };
  }

  const query = `?userId=${encodeURIComponent(id)}${buildTelegramIdentityQuery()}`;

  try {
    const res = await fetch(`${API_BASE}/api/wallet${query}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...buildTelegramAuthHeaders(),
      },
    });

    if (!res.ok) {
      throw new Error(`Wallet fetch failed: ${res.status}`);
    }

    const data = normalizeWalletPage(await res.json());
    console.log('[wallet] loaded', {
      userId: id,
      mainWallet: data.mainWallet,
      playWallet: data.playWallet,
      phone: data.phone ? '(set)' : '(empty)',
      verified: data.verified,
    });
    return data;
  } catch (err) {
    console.error('[wallet] fetch failed', { userId: id, err });
    return { ...EMPTY_WALLET_PAGE, loadError: true, authError: false };
  }
}

/** @deprecated Use fetchWalletPage */
export async function fetchWalletBalance(userId = getPlayerUserId()) {
  const page = await fetchWalletPage(userId);
  return parseWalletPayload(page);
}

/** Register socket wallet listener; returns cleanup function */
export function subscribeWalletUpdates(userId, onUpdate) {
  const id = userId || getPlayerUserId();
  if (!id) return () => {};

  const socket = getSocket();

  const handler = (payload) => onUpdate(parseWalletPayload(payload));

  const register = () => {
    socket.emit(
      'wallet:register',
      { userId: id, telegramId: id, ...getTelegramIdentityPayload() },
      (ack) => {
        if (ack?.ok !== false) onUpdate(parseWalletPayload(ack));
      }
    );
  };

  socket.on('wallet:update', handler);
  if (socket.connected) {
    register();
  } else {
    socket.once('connect', register);
  }

  return () => {
    socket.off('wallet:update', handler);
  };
}

/** Full wallet page sync (balances + transactions + phone) */
export function subscribeWalletPage(userId, onPage) {
  const id = userId || getPlayerUserId();
  if (!id) return () => {};

  const socket = getSocket();

  const applyPage = (payload) => {
    if (payload?.ok === false) return;
    onPage(normalizeWalletPage(payload));
  };

  const onBalance = () => {
    fetchWalletPage(id).then(onPage);
  };

  const register = () => {
    socket.emit(
      'wallet:register',
      { userId: id, telegramId: id, ...getTelegramIdentityPayload() },
      (ack) => {
        applyPage(ack);
      }
    );
  };

  socket.on('wallet:page', applyPage);
  socket.on('wallet:update', onBalance);
  if (socket.connected) {
    register();
  } else {
    socket.once('connect', register);
  }

  return () => {
    socket.off('wallet:page', applyPage);
    socket.off('wallet:update', onBalance);
  };
}
