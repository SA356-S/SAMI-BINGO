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
  } else if (auth.userId && !socketInstance.connected) {
    socketInstance.connect();
  }

  return socketInstance;
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
