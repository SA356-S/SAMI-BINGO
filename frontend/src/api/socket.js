import { io } from 'socket.io-client';
import { resolveServerUrl } from './resolveServerUrl';
import {
  getPlayerUserId,
  getTelegramUser,
  getTelegramInitData,
} from './playerIdentity';

export const SOCKET_URL = resolveServerUrl();
let socketInstance = null;

function buildSocketAuth() {
  const user = getTelegramUser();
  const userId = getPlayerUserId();
  return {
    userId: userId ?? undefined,
    telegramId: userId ?? undefined,
    firstName: user?.first_name,
    lastName: user?.last_name,
    username: user?.username,
    initData: getTelegramInitData(),
  };
}

/** Shared Socket.io client — reconnects when Telegram user id becomes available. */
export function getSocket() {
  const auth = buildSocketAuth();
  const prevId = socketInstance?.io?.opts?.auth?.userId;

  if (!socketInstance || (auth.userId && prevId !== auth.userId)) {
    if (socketInstance) {
      socketInstance.removeAllListeners();
      socketInstance.disconnect();
      socketInstance = null;
    }

    if (!auth.userId) {
      console.warn('[socket] deferred — Telegram user id not available yet');
    } else {
      console.log('[socket] connecting', { userId: auth.userId, username: auth.username });
    }

    socketInstance = io(SOCKET_URL, {
      transports: ['polling', 'websocket'],
      autoConnect: Boolean(auth.userId),
      path: '/socket.io',
      auth,
    });

    import('../services/lobbySession')
      .then(({ rebindLobbySocketHandlers }) => rebindLobbySocketHandlers())
      .catch(() => {});
    import('../audio/gameAudioSync')
      .then(({ rebindGameAudioSync }) => rebindGameAudioSync())
      .catch(() => {});
  } else if (auth.userId && !socketInstance.connected) {
    socketInstance.connect();
  }

  return socketInstance;
}

const SOCKET_CONNECT_TIMEOUT_MS = 12000;
const SOCKET_RETRY_ATTEMPTS = 3;
const SOCKET_RETRY_MIN_MS = 500;
const SOCKET_RETRY_MAX_MS = 1500;

function socketRetryDelayMs(attemptIndex) {
  return Math.min(
    SOCKET_RETRY_MAX_MS,
    SOCKET_RETRY_MIN_MS + attemptIndex * 350
  );
}

/** Wait until the shared socket is connected (or timeout). */
export function ensureSocketConnected(timeoutMs = SOCKET_CONNECT_TIMEOUT_MS) {
  const socket = getSocket();
  if (socket.connected) {
    return Promise.resolve(socket);
  }

  return new Promise((resolve, reject) => {
    let settled = false;

    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.off('connect', onConnect);
      socket.off('connect_error', onConnectError);
      if (err) reject(err);
      else resolve(value);
    };

    const onConnect = () => finish(null, socket);
    const onConnectError = (err) =>
      finish(err ?? new Error('socket_connect_error'));

    const timer = setTimeout(
      () => finish(new Error('socket_connect_timeout')),
      timeoutMs
    );

    socket.on('connect', onConnect);
    socket.on('connect_error', onConnectError);
    if (!socket.connected) {
      socket.connect();
    }
  });
}

/**
 * Retry socket connection up to 3 times with backoff (500–1500ms).
 * Never throws into callers that must stay alive — returns null on total failure.
 */
export async function ensureSocketConnectedWithRetry(options = {}) {
  const maxAttempts = options.maxAttempts ?? SOCKET_RETRY_ATTEMPTS;
  const timeoutMs = options.timeoutMs ?? SOCKET_CONNECT_TIMEOUT_MS;
  let lastError = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (attempt > 0) {
      const delayMs = socketRetryDelayMs(attempt - 1);
      console.log('[game-init] SOCKET_CONNECTING', {
        attempt: attempt + 1,
        maxAttempts,
        delayMs,
      });
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    } else {
      console.log('[game-init] SOCKET_CONNECTING', { attempt: 1, maxAttempts });
    }

    try {
      const socket = await ensureSocketConnected(timeoutMs);
      console.log('[game-init] SOCKET_READY', { attempt: attempt + 1 });
      return socket;
    } catch (err) {
      lastError = err;
      console.warn('[game-init] SOCKET_CONNECTING failed', {
        attempt: attempt + 1,
        reason: err?.message ?? String(err),
      });
      try {
        const socket = getSocket();
        if (socket.connected) socket.disconnect();
      } catch {
        /* ignore disconnect errors during retry */
      }
    }
  }

  console.warn('[game-init] INIT_FAILED', {
    step: 'socket',
    reason: lastError?.message ?? 'socket_connect_failed',
  });
  return null;
}

export function disconnectSocket() {
  if (socketInstance) {
    socketInstance.removeAllListeners();
    socketInstance.disconnect();
    socketInstance = null;
  }
}

/** Reconnect socket after Telegram identity is ready. */
export function connectSocketWithTelegramAuth() {
  disconnectSocket();
  const socket = getSocket();
  import('../services/lobbySession')
    .then(({ rebindLobbySocketHandlers }) => rebindLobbySocketHandlers())
    .catch(() => {});
  import('../audio/gameAudioSync')
    .then(({ rebindGameAudioSync }) => rebindGameAudioSync())
    .catch(() => {});
  return socket;
}
/** Normalize called-ball arrays from REST or socket payloads */
export function normalizeCalledNumbers(data = {}) {
  const called =
    data.calledNumbers ??
    data.calledHistory ??
    data.called ??
    data.balls ??
    [];

  if (!Array.isArray(called)) return [];
  return called.map(Number).filter((n) => n >= 1 && n <= 75);
}

/** Build cartelId -> 5×5 grid map from server `cards` array */
export function cardsToGridMap(cards) {
  const map = {};
  if (!Array.isArray(cards)) return map;
  for (const card of cards) {
    if (card?.cartelId != null && Array.isArray(card.grid)) {
      map[Number(card.cartelId)] = card.grid;
    }
  }
  return map;
}

/** Apply wallet:update (or bingo ack) payload to React wallet setters */
export function applyWalletSnapshot(data, setters) {
  if (!data || typeof setters !== 'object') return;

  const { setMainWallet, setPlayWallet, setTotalWalletBalance } = setters;
  const main = Number(data.mainWallet ?? data.wallets?.main);
  const play = Number(data.playWallet ?? data.wallets?.play);
  const mainSafe = Number.isFinite(main) ? Math.max(0, main) : null;
  const playSafe = Number.isFinite(play) ? Math.max(0, play) : null;

  if (setMainWallet && mainSafe != null) setMainWallet(mainSafe);
  if (setPlayWallet && playSafe != null) setPlayWallet(playSafe);

  if (setTotalWalletBalance) {
    const total = Number(data.totalWalletBalance ?? data.wallets?.total);
    const combined =
      Number.isFinite(total) && total >= 0
        ? total
        : (mainSafe ?? 0) + (playSafe ?? 0);
    setTotalWalletBalance(combined);
  }
}

/** Cards belonging to this client only (never merge another socket's grids). */
export function extractMyCards(data, mySocketId) {
  const cartelIds = new Set(
    (data.myCartels ?? data.selectedCartels ?? []).map(Number)
  );
  const cards = data.myCards ?? data.cards;
  if (!Array.isArray(cards) || cartelIds.size === 0) return [];

  return cards.filter((card) => {
    if (card?.socketId && mySocketId && card.socketId !== mySocketId) {
      return false;
    }
    return cartelIds.has(Number(card.cartelId));
  });
}

/** Apply server game snapshot to React setters */
export function applyServerGameState(data, setters) {
  if (!data || typeof setters !== 'object') return;

  const {
    setGameId,
    setPlayersCount,
    setCalledHistory,
    setCartelGrids,
    setDerash,
    setTotalCards,
    setMySocketId,
    setMyCartels,
    setCartelOwnership,
  } = setters;

  if (data.gameId && setGameId) setGameId(data.gameId);

  if (data.socketId && setMySocketId) {
    setMySocketId(String(data.socketId));
  }

  if (setMyCartels && Array.isArray(data.myCartels)) {
    setMyCartels(data.myCartels.map(Number));
  } else if (
    setMyCartels &&
    Array.isArray(data.selectedCartels) &&
    data.selectedCartels.length > 0 &&
    !('myCartels' in data)
  ) {
    setMyCartels(data.selectedCartels.map(Number));
  } else if (setMyCartels && data.clearGame) {
    setMyCartels([]);
  }

  if (setCartelOwnership && data.cartelOwnership) {
    const normalized = {};
    for (const [key, value] of Object.entries(data.cartelOwnership)) {
      normalized[Number(key)] = value;
    }
    setCartelOwnership(normalized);
  } else if (setCartelOwnership && data.clearGame) {
    setCartelOwnership({});
  }

  if (setCartelGrids && data.clearGame) {
    setCartelGrids({});
  }

  const players = Number(
    Array.isArray(data.players) ? data.players.length : data.playersCount
  );
  if (setPlayersCount && Number.isFinite(players) && players >= 0) {
    setPlayersCount(players);
  }

  const totalCards = Number(data.totalCards ?? data.totalCartels);
  if (setTotalCards && Number.isFinite(totalCards) && totalCards >= 0) {
    setTotalCards(totalCards);
  }

  if (
    setCalledHistory &&
    ('calledNumbers' in data ||
      'calledHistory' in data ||
      'called' in data ||
      'balls' in data ||
      'number' in data)
  ) {
    setCalledHistory(normalizeCalledNumbers(data));
  }

  const viewerSocketId = data.socketId ?? setters.mySocketId;
  const myCards = extractMyCards(data, viewerSocketId);
  if (setCartelGrids && myCards.length > 0) {
    setCartelGrids((prev) => ({ ...prev, ...cardsToGridMap(myCards) }));
  }

  const pot = Number(data.derash ?? data.pot);
  if (setDerash && Number.isFinite(pot)) setDerash(pot);
}
