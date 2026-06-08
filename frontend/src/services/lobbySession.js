import { fetchGameData } from '../api/cardSelection';
import { getSocket } from '../api/socket';
import { getPlayerUserId } from '../api/playerIdentity';
import { normalizeGameStatus } from '../utils/gameStatus';
import { getLastBootstrapUserId } from './playerSession';
import {
  buildMainGameEntryState,
  isLobbyGameStarted,
} from '../utils/mainGameEntry';

function activeUserId() {
  return getPlayerUserId() || getLastBootstrapUserId();
}

const SELECT_ACK_TIMEOUT_MS = 12000;
const COUNTDOWN_TICK_MS = 1000;
const DEFAULT_LOBBY_COUNTDOWN_SEC = 45;

/** @type {import('react-router-dom').NavigateFunction | null} */
let navigateRef = null;

let state = {
  selectedCartels: [],
  gameId: null,
  countdownSeconds: DEFAULT_LOBBY_COUNTDOWN_SEC,
  countdownEndsAt: null,
  /** Client-local ms deadline for smooth ticking between server syncs */
  countdownDeadlineLocal: null,
  serverTimeOffset: 0,
  takenCartels: new Set(),
  cartelOwnership: {},
  playersCount: 0,
  lobbyPhase: 'COUNTDOWN_RUNNING',
  gameStatus: 'WAITING',
  selectionLocked: false,
  gameInProgress: false,
  lastLoggedRemaining: null,
  countdownExpiredSignaled: false,
};

const listeners = new Set();
let socketHandlersRegistered = false;
let localTickTimer = null;
let selectionSyncInFlight = false;
let selectionSyncGeneration = 0;
let gameStartNavigateDone = false;

const GAME_ENTRY_STAKE = 10;

function maybeNavigateToMainGame() {
  if (!navigateRef || gameStartNavigateDone) return;
  if (!isLobbyGameStarted(state)) return;

  gameStartNavigateDone = true;
  navigateRef('/main-game', {
    replace: true,
    state: buildMainGameEntryState({
      selectedCartels: state.selectedCartels,
      gameId: state.gameId,
      playersCount: state.playersCount,
      stake: GAME_ENTRY_STAKE,
    }),
  });
}

function logCountdown(event, detail = {}) {
  console.log('[countdown]', event, {
    remaining: getCountdownRemaining(),
    ...detail,
  });
}

function notify() {
  const snapshot = getLobbyState();
  listeners.forEach((fn) => fn(snapshot));
}

export function getLobbyState() {
  return {
    selectedCartels: [...state.selectedCartels],
    gameId: state.gameId,
    countdownSeconds: getCountdownRemaining(),
    countdownEndsAt: state.countdownEndsAt,
    takenCartels: new Set(state.takenCartels),
    cartelOwnership: { ...state.cartelOwnership },
    playersCount: state.playersCount,
    lobbyPhase: state.lobbyPhase,
    gameStatus: state.gameStatus,
    selectionLocked: state.selectionLocked,
    gameInProgress: state.gameInProgress,
  };
}

export function getCountdownRemaining() {
  if (state.countdownDeadlineLocal != null) {
    return Math.max(
      0,
      Math.ceil((state.countdownDeadlineLocal - Date.now()) / 1000)
    );
  }
  if (state.countdownEndsAt != null) {
    return Math.max(0, Math.ceil((state.countdownEndsAt - Date.now()) / 1000));
  }
  return Math.max(0, Number(state.countdownSeconds) || 0);
}

function anchorCountdownDeadline(endsAtMs, serverTimeMs) {
  const endsAt = Number(endsAtMs);
  if (!Number.isFinite(endsAt)) return;

  state.countdownEndsAt = endsAt;
  const serverNow = Number(serverTimeMs);
  if (Number.isFinite(serverNow)) {
    state.serverTimeOffset = serverNow - Date.now();
    state.countdownDeadlineLocal = endsAt + (Date.now() - serverNow);
  } else {
    state.countdownDeadlineLocal = endsAt;
  }
  state.countdownSeconds = getCountdownRemaining();
}

function anchorCountdownFromSeconds(seconds, serverTimeMs) {
  const sec = Math.max(0, Number(seconds) || 0);
  const serverNow = Number(serverTimeMs);
  const endsAt =
    Number.isFinite(serverNow) && serverNow > 0
      ? serverNow + sec * 1000
      : Date.now() + sec * 1000;
  anchorCountdownDeadline(endsAt, serverTimeMs ?? Date.now());
}

function applyServerTime(payload) {
  const serverNow =
    payload?.serverTime != null ? Number(payload.serverTime) : null;

  if (serverNow != null && Number.isFinite(serverNow)) {
    state.serverTimeOffset = serverNow - Date.now();
  }

  if (payload?.countdownEndsAt != null) {
    anchorCountdownDeadline(payload.countdownEndsAt, serverNow);
    logCountdown('sync-deadline', {
      endsAt: state.countdownEndsAt,
      deadlineLocal: state.countdownDeadlineLocal,
    });
  } else if (payload?.countdownSeconds != null) {
    anchorCountdownFromSeconds(payload.countdownSeconds, serverNow);
    logCountdown('sync-seconds', { seconds: payload.countdownSeconds });
  }
}

function mergeServerCartels(serverCartels) {
  if (!Array.isArray(serverCartels)) return;

  const next = serverCartels.map(Number).filter((n) => n >= 1);

  if (next.length > 0) {
    state.selectedCartels = next;
    return;
  }

  if (selectionSyncInFlight && state.selectedCartels.length > 0) {
    return;
  }

  if (state.selectedCartels.length === 0) {
    state.selectedCartels = next;
  }
}

export function applyLobbyPayload(
  payload = {},
  { mergeCartels = false, mergeTaken = true } = {}
) {
  if (!payload || typeof payload !== 'object') return;

  applyServerTime(payload);

  if (payload.lobbyPhase || payload.phase) {
    state.lobbyPhase = payload.lobbyPhase ?? payload.phase;
  }

  if (payload.clearSelections || payload.clearGame) {
    state.selectedCartels = [];
    state.lobbyPhase = payload.lobbyPhase ?? payload.phase ?? 'COUNTDOWN_RUNNING';
    state.countdownExpiredSignaled = false;
  } else if (mergeCartels) {
    mergeServerCartels(payload.myCartels ?? payload.selectedCartels);
  }

  if (payload.gameId) state.gameId = payload.gameId;

  if (mergeTaken) {
    const others =
      payload.takenByOthers ?? payload.takenByOther ?? null;
    const taken = payload.takenCartels ?? payload.taken ?? payload.occupied;
    if (Array.isArray(others)) {
      state.takenCartels = new Set(others.map(Number).filter((n) => n >= 1));
    } else if (Array.isArray(taken)) {
      const mine = new Set(state.selectedCartels);
      state.takenCartels = new Set(
        taken.map(Number).filter((n) => n >= 1 && !mine.has(n))
      );
    }
  }

  if (payload.playersCount != null) {
    state.playersCount = Number(payload.playersCount) || 0;
  }

  if (payload.cartelOwnership && typeof payload.cartelOwnership === 'object') {
    state.cartelOwnership = payload.cartelOwnership;
  }

  if (payload.selectionLocked != null) {
    state.selectionLocked = Boolean(payload.selectionLocked);
  }
  if (payload.gameInProgress != null) {
    state.gameInProgress = Boolean(payload.gameInProgress);
  } else if (payload.status === 'calling') {
    state.gameInProgress = true;
  }
  if (payload.status === 'waiting' && !payload.selectionLocked) {
    state.selectionLocked = false;
    state.gameInProgress = false;
  }

  state.gameStatus = normalizeGameStatus(payload);

  notify();

  if (isLobbyGameStarted(state)) {
    maybeNavigateToMainGame();
  }
}

export function setLocalSelectedCartels(cartels) {
  state.selectedCartels = [...cartels].map(Number).filter((n) => n >= 1);
  notify();
}

export function subscribeLobby(listener) {
  listeners.add(listener);
  listener(getLobbyState());
  return () => listeners.delete(listener);
}

function syncSelectionToServer() {
  const socket = getSocket();
  const userId = activeUserId();
  const generation = ++selectionSyncGeneration;
  const cartels = [...state.selectedCartels];

  selectionSyncInFlight = true;

  let settled = false;
  const finish = (ack) => {
    if (settled || generation !== selectionSyncGeneration) return;
    settled = true;
    selectionSyncInFlight = false;

    if (!ack || ack.ok === false) {
      console.warn('[cartel] reservation failed', ack?.error ?? ack);
      if (ack?.error === 'insufficient_balance') {
        const restored = ack.myCartels ?? ack.selectedCartels ?? [];
        state.selectedCartels = Array.isArray(restored)
          ? restored.map(Number).filter((n) => n >= 1)
          : [];
      }
      if (ack?.selectionLocked || ack?.error === 'game_in_progress') {
        state.selectionLocked = true;
        state.gameInProgress = true;
        state.gameStatus = normalizeGameStatus(ack);
      }
      notify();
      return;
    }

    applyLobbyPayload(ack, { mergeCartels: true, mergeTaken: true });
  };

  const timer = setTimeout(() => {
    finish({ ok: false, error: 'timeout' });
  }, SELECT_ACK_TIMEOUT_MS);

  const onAck = (ack) => {
    clearTimeout(timer);
    finish(ack);
  };

  const payload = {
    gameId: state.gameId ?? undefined,
    selectedCartels: cartels,
    cartelIds: cartels,
    playerName: userId,
    userId,
    telegramId: userId,
  };

  const emitNow = () => socket.emit('game:select-cartels', payload, onAck);

  if (socket.connected) {
    emitNow();
  } else {
    socket.once('connect', emitNow);
    socket.connect();
  }
}

export function updateSelectedCartels(cartels) {
  if (state.selectionLocked || state.gameInProgress) {
    notify();
    return;
  }

  const prev = new Set(state.selectedCartels);
  const next = [...cartels].map(Number).filter((n) => n >= 1);
  const nextSet = new Set(next);

  for (const id of prev) {
    if (!nextSet.has(id)) {
      state.takenCartels.delete(id);
    }
  }

  state.selectedCartels = next;
  notify();
  syncSelectionToServer();
}

async function refreshFromApi() {
  const userId = activeUserId();
  const data = await fetchGameData(userId);
  applyLobbyPayload(
    {
      gameId: data.gameId,
      takenCartels: [...data.takenCartels],
      myCartels: data.myCartels,
      selectedCartels: data.selectedCartels,
      countdownSeconds: data.countdownSeconds,
      countdownEndsAt: data.countdownEndsAt,
      serverTime: data.serverTime,
      playersCount: data.playersCount,
      lobbyPhase: data.lobbyPhase,
      status: data.status,
      selectionLocked: data.selectionLocked,
      gameInProgress: data.gameInProgress,
      gameStatus: data.gameStatus,
    },
    { mergeCartels: true, mergeTaken: true }
  );
}

function onLocalCountdownTick() {
  const remaining = getCountdownRemaining();

  if (state.lastLoggedRemaining !== remaining) {
    if (remaining % 5 === 0 || remaining <= 5 || state.lastLoggedRemaining == null) {
      logCountdown('tick', { remaining });
    }
    state.lastLoggedRemaining = remaining;
  }

  if (
    remaining <= 0 &&
    state.countdownEndsAt != null &&
    !state.countdownExpiredSignaled
  ) {
    state.countdownExpiredSignaled = true;
    logCountdown('reached-zero');

    const socket = getSocket();
    const userId = activeUserId();
    if (socket.connected) {
      socket.emit('game:lobby-sync', { userId, telegramId: userId });
    }
  } else if (remaining > 0) {
    state.countdownExpiredSignaled = false;
  }

  notify();
}

function ensureLocalCountdownTicker() {
  if (localTickTimer != null) return;
  localTickTimer = setInterval(onLocalCountdownTick, COUNTDOWN_TICK_MS);
  logCountdown('ticker-started', { intervalMs: COUNTDOWN_TICK_MS });
  onLocalCountdownTick();
}

function registerLobbySocketHandlers() {
  if (socketHandlersRegistered) return;
  socketHandlersRegistered = true;

  const socket = getSocket();

  const onLobbyTick = (payload) => {
    applyLobbyPayload(payload, { mergeCartels: false, mergeTaken: true });
  };

  const onGameStart = (payload) => {
    applyLobbyPayload(payload, { mergeCartels: true, mergeTaken: true });
    logCountdown('game-start-state-only', { gameId: state.gameId });
  };

  const onSelectionUpdate = (payload) => {
    applyLobbyPayload(payload, { mergeCartels: false, mergeTaken: true });
  };

  const onGameReset = (payload) => {
    if (!payload?.clearGame && payload?.status !== 'waiting') return;
    applyLobbyPayload(
      {
        ...payload,
        clearSelections: true,
        takenCartels: payload.takenCartels ?? [],
        lobbyPhase: payload.lobbyPhase ?? 'COUNTDOWN_RUNNING',
        selectionLocked: false,
        gameInProgress: false,
      },
      { mergeCartels: false, mergeTaken: true }
    );
    state.selectionLocked = false;
    state.gameInProgress = false;
    state.cartelOwnership = {};
    state.countdownExpiredSignaled = false;
    gameStartNavigateDone = false;
    logCountdown('reset');
  };

  const register = () => {
    const userId = activeUserId();
    socket.emit('game:lobby-sync', { userId, telegramId: userId }, (ack) => {
      if (ack?.ok !== false) {
        applyLobbyPayload(ack, { mergeCartels: true, mergeTaken: true });
        logCountdown('lobby-sync', { userId });
      }
    });
  };

  socket.on('game:lobby-tick', onLobbyTick);
  socket.on('game:started', onGameStart);
  socket.on('game_start', onGameStart);
  socket.on('game:start', onGameStart);
  socket.on('game:selection-update', onSelectionUpdate);
  socket.on('game:reset', onGameReset);
  socket.on('game:redirect', onGameReset);

  socket.on('connect', () => {
    register();
    if (state.selectedCartels.length > 0) {
      syncSelectionToServer();
    }
  });

  if (socket.connected) {
    register();
  } else {
    socket.once('connect', register);
  }

  logCountdown('socket-handlers-registered');
}

/**
 * App-level lobby sync — survives Card Selection unmount/navigation.
 */
export function initLobbySession(navigate) {
  navigateRef = navigate;
  ensureLocalCountdownTicker();
  registerLobbySocketHandlers();
  refreshFromApi();

  return () => {};
}

export function resetLobbyAfterGameEnd() {
  state.selectedCartels = [];
  state.lobbyPhase = 'COUNTDOWN_RUNNING';
  state.countdownExpiredSignaled = false;
  refreshFromApi();
}
