import { fetchGameData } from '../api/cardSelection';
import { getSocket } from '../api/socket';
import { getPlayerUserId } from '../api/playerIdentity';
import { normalizeGameStatus } from '../utils/gameStatus';
import { getLastBootstrapUserId } from './playerSession';
import {
  buildMainGameEntryState,
  isLobbyGameStarted,
} from '../utils/mainGameEntry';
import {
  canAutoNavigateToMainGame,
  isMainGameAutoEntryBlocked,
  releaseMainGameAutoEntry,
} from './gameSessionLifecycle';
import { unlockGameAudio } from '../audio/gameSounds';

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
  lobbyRevision: 0,
};

const listeners = new Set();
let socketHandlersRegistered = false;
/** @type {import('socket.io-client').Socket | null} */
let lobbyBoundSocket = null;
let localTickTimer = null;
let selectionSyncInFlight = false;
let selectionSyncGeneration = 0;
/** Cartelas removed locally — ignore server taken until select ack confirms release */
const pendingReleaseCartels = new Set();
/** True after local toggle until server ack confirms selection */
let localSelectionDirty = false;
let gameStartNavigateDone = false;
let lastNotifyFingerprint = '';
let lastLocalCountdownRemaining = null;

const GAME_ENTRY_STAKE = 10;

function releaseMainGameAutoEntryIfIdle() {
  if (!isMainGameAutoEntryBlocked()) return;
  if (!isLobbyGameStarted(state)) {
    releaseMainGameAutoEntry();
  }
}

function maybeNavigateToMainGame() {
  if (!navigateRef || gameStartNavigateDone) return;
  if (!canAutoNavigateToMainGame()) return;
  if (!isLobbyGameStarted(state)) return;

  gameStartNavigateDone = true;
  void unlockGameAudio();
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

function lobbyNotifyFingerprint() {
  const taken = [...state.takenCartels].sort((a, b) => a - b).join(',');
  const selected = state.selectedCartels.join(',');
  return [
    state.gameId ?? '',
    getCountdownRemaining(),
    state.countdownEndsAt ?? '',
    state.playersCount,
    state.lobbyPhase ?? '',
    state.gameStatus ?? '',
    state.selectionLocked ? '1' : '0',
    state.gameInProgress ? '1' : '0',
    selected,
    taken,
  ].join('|');
}

function notify(force = false) {
  const fp = lobbyNotifyFingerprint();
  if (!force && fp === lastNotifyFingerprint) return;
  lastNotifyFingerprint = fp;
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

function parseLobbyRevision(payload) {
  const raw =
    payload?.lobbyRevision ?? payload?.selectionVersion ?? payload?.stateEpoch;
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function isStaleLobbyRevision(payload) {
  const incoming = parseLobbyRevision(payload);
  if (incoming == null) return false;
  return incoming < state.lobbyRevision;
}

function applyLobbyRevisionFromPayload(payload) {
  const incoming = parseLobbyRevision(payload);
  if (incoming != null && incoming >= state.lobbyRevision) {
    state.lobbyRevision = incoming;
  }
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

function hasPendingSelection() {
  return (
    localSelectionDirty ||
    selectionSyncInFlight ||
    pendingReleaseCartels.size > 0
  );
}

function selectionSignature(cartels) {
  return [...cartels].map(Number).filter((n) => n >= 1).sort((a, b) => a - b).join(',');
}

function extractTakenSource(payload = {}) {
  const others = payload.takenByOthers ?? payload.takenByOther ?? null;
  const takenRaw = payload.takenCartels ?? payload.taken ?? payload.occupied;

  if (Array.isArray(others)) {
    return others;
  }
  if (Array.isArray(takenRaw)) {
    return takenRaw;
  }
  if (takenRaw instanceof Set) {
    return [...takenRaw];
  }
  return [];
}

function payloadHasTakenFields(payload = {}) {
  return (
    payload.takenByOthers != null ||
    payload.takenByOther != null ||
    payload.takenCartels != null ||
    payload.taken != null ||
    payload.occupied != null
  );
}

/** Derive takenCartels from server payload + current local selection authority. */
function applyTakenFromServer(payload = {}) {
  if (!payloadHasTakenFields(payload)) {
    return;
  }

  const mine = new Set(state.selectedCartels);
  const incoming = extractTakenSource(payload)
    .map(Number)
    .filter((n) => n >= 1 && !mine.has(n) && !pendingReleaseCartels.has(n));

  if (!hasPendingSelection()) {
    state.takenCartels = new Set(incoming);
    return;
  }

  const next = new Set(state.takenCartels);
  for (const id of [...next]) {
    if (mine.has(id) || pendingReleaseCartels.has(id)) {
      next.delete(id);
    }
  }
  for (const id of incoming) {
    if (!mine.has(id) && !pendingReleaseCartels.has(id)) {
      next.add(id);
    }
  }
  state.takenCartels = next;
}

function mergeServerCartels(serverCartels) {
  if (!Array.isArray(serverCartels) || hasPendingSelection()) {
    return;
  }

  const next = serverCartels.map(Number).filter((n) => n >= 1);

  if (next.length === 0 && state.selectedCartels.length > 0) {
    return;
  }

  state.selectedCartels = next;
  for (const id of next) {
    pendingReleaseCartels.delete(id);
  }
}

/** ACK confirms server accepted the in-flight list — never overrides newer local edits. */
function confirmSelectionAck(ack = {}) {
  const raw = ack.myCartels ?? ack.selectedCartels ?? [];
  const confirmed = Array.isArray(raw)
    ? raw.map(Number).filter((n) => n >= 1)
    : [];

  if (selectionSignature(confirmed) !== selectionSignature(state.selectedCartels)) {
    return false;
  }

  localSelectionDirty = false;
  for (const id of confirmed) {
    pendingReleaseCartels.delete(id);
  }
  for (const id of [...pendingReleaseCartels]) {
    if (!confirmed.includes(id)) {
      pendingReleaseCartels.delete(id);
    }
  }
  return true;
}

function applyLocalSelectionChange(next) {
  const prev = new Set(state.selectedCartels);
  const nextSet = new Set(next);

  for (const id of prev) {
    if (!nextSet.has(id)) {
      state.takenCartels.delete(id);
      pendingReleaseCartels.add(id);
    }
  }

  for (const id of next) {
    pendingReleaseCartels.delete(id);
    state.takenCartels.delete(id);
  }

  state.selectedCartels = next;
  localSelectionDirty = true;
}

export function applyLobbyPayload(
  payload = {},
  { mergeCartels = false, mergeTaken = true, replace = false } = {}
) {
  if (!payload || typeof payload !== 'object') return;

  const bypassRevision = Boolean(payload.clearSelections || payload.clearGame);
  if (!bypassRevision && isStaleLobbyRevision(payload)) {
    return;
  }
  applyLobbyRevisionFromPayload(payload);

  applyServerTime(payload);

  if (payload.lobbyPhase || payload.phase) {
    state.lobbyPhase = payload.lobbyPhase ?? payload.phase;
  }

  if (payload.clearSelections || payload.clearGame) {
    state.selectedCartels = [];
    pendingReleaseCartels.clear();
    localSelectionDirty = false;
    state.lobbyPhase = payload.lobbyPhase ?? payload.phase ?? 'COUNTDOWN_RUNNING';
    state.countdownExpiredSignaled = false;
    releaseMainGameAutoEntryIfIdle();
  } else if (replace) {
    if (!hasPendingSelection()) {
      const serverCartels = payload.myCartels ?? payload.selectedCartels;
      state.selectedCartels = Array.isArray(serverCartels)
        ? serverCartels.map(Number).filter((n) => n >= 1)
        : [];
    }
  } else if (mergeCartels) {
    mergeServerCartels(payload.myCartels ?? payload.selectedCartels);
  }

  if (payload.gameId) state.gameId = payload.gameId;

  if (mergeTaken || replace) {
    if (
      replace &&
      !hasPendingSelection() &&
      !Array.isArray(payload.takenCartels ?? payload.taken)
    ) {
      state.takenCartels = new Set();
    } else {
      applyTakenFromServer(payload);
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
    releaseMainGameAutoEntryIfIdle();
  }

  state.gameStatus = normalizeGameStatus(payload);

  if (isMainGameAutoEntryBlocked() && isLobbyGameStarted(state)) {
    state.gameInProgress = false;
    state.gameStatus = 'WAITING';
    state.selectionLocked = false;
    if (state.lobbyPhase === 'GAME_STARTED') {
      state.lobbyPhase = 'COUNTDOWN_RUNNING';
    }
  }

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
        if (!isStaleLobbyRevision(ack)) {
          applyLobbyRevisionFromPayload(ack);
          const restored = ack.myCartels ?? ack.selectedCartels ?? [];
          state.selectedCartels = Array.isArray(restored)
            ? restored.map(Number).filter((n) => n >= 1)
            : [];
          pendingReleaseCartels.clear();
          localSelectionDirty = false;
          for (const id of state.selectedCartels) {
            pendingReleaseCartels.delete(id);
          }
        }
      }
      if (ack?.selectionLocked || ack?.error === 'game_in_progress') {
        state.selectionLocked = true;
        state.gameInProgress = true;
        state.gameStatus = normalizeGameStatus(ack);
      }
      notify();
      return;
    }

    if (isStaleLobbyRevision(ack)) {
      console.warn('[cartel] stale select ack ignored', {
        incoming: parseLobbyRevision(ack),
        current: state.lobbyRevision,
      });
      if (localSelectionDirty) {
        syncSelectionToServer();
      }
      return;
    }

    applyLobbyRevisionFromPayload(ack);
    confirmSelectionAck(ack);
    applyLobbyPayload(
      {
        ...ack,
        myCartels: undefined,
        selectedCartels: undefined,
      },
      { mergeCartels: false, mergeTaken: true }
    );
    notify(true);
  };

  const timer = setTimeout(() => {
    finish({ ok: false, error: 'timeout' });
    if (localSelectionDirty && generation === selectionSyncGeneration) {
      syncSelectionToServer();
    }
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

  const next = [...cartels].map(Number).filter((n) => n >= 1);
  if (selectionSignature(next) === selectionSignature(state.selectedCartels)) {
    return;
  }

  applyLocalSelectionChange(next);
  lastNotifyFingerprint = '';
  notify(true);
  syncSelectionToServer();
}

/**
 * Toggle cartel selection using module state (safe for rapid clicks — no React stale closures).
 * @returns {{ ok: boolean, reason?: 'locked'|'taken'|'max'|'balance' }}
 */
export function toggleCartelSelection(
  num,
  { maxCartels = 2, entryStake = GAME_ENTRY_STAKE, totalWalletBalance = 0 } = {}
) {
  const n = Number(num);
  if (!Number.isFinite(n) || n < 1) {
    return { ok: false, reason: 'invalid' };
  }

  if (state.selectionLocked || state.gameInProgress) {
    return { ok: false, reason: 'locked' };
  }

  const current = state.selectedCartels;
  const isSelected = current.includes(n);

  if (isSelected) {
    updateSelectedCartels(current.filter((id) => id !== n));
    return { ok: true, action: 'deselect' };
  }

  if (state.takenCartels.has(n)) {
    return { ok: false, reason: 'taken' };
  }

  if (current.length >= maxCartels) {
    return { ok: false, reason: 'max' };
  }

  if (totalWalletBalance < entryStake * (current.length + 1)) {
    return { ok: false, reason: 'balance' };
  }

  const next = [...current, n]
    .sort((a, b) => a - b)
    .slice(0, maxCartels);
  updateSelectedCartels(next);
  return { ok: true, action: 'select' };
}

export function isCartelTakenByOthers(num) {
  const n = Number(num);
  if (state.selectedCartels.includes(n)) return false;
  if (pendingReleaseCartels.has(n)) return false;
  return state.takenCartels.has(n);
}

async function refreshFromApi({ replace = false } = {}) {
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
      lobbyRevision: data.lobbyRevision,
      selectionVersion: data.selectionVersion,
    },
    { mergeCartels: !replace, mergeTaken: true, replace }
  );
}

function onLocalCountdownTick() {
  const remaining = getCountdownRemaining();
  const countdownChanged = remaining !== lastLocalCountdownRemaining;
  lastLocalCountdownRemaining = remaining;

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

  if (countdownChanged) {
    notify();
  }
}

function ensureLocalCountdownTicker() {
  if (localTickTimer != null) return;
  localTickTimer = setInterval(onLocalCountdownTick, COUNTDOWN_TICK_MS);
  logCountdown('ticker-started', { intervalMs: COUNTDOWN_TICK_MS });
  onLocalCountdownTick();
}

function unbindLobbySocketHandlers(socket) {
  if (!socket) return;
  socket.off('game:lobby-tick', socket.__onLobbyTick);
  socket.off('game:started', socket.__onGameStart);
  socket.off('game_start', socket.__onGameStart);
  socket.off('game:start', socket.__onGameStart);
  socket.off('game:selection-update', socket.__onSelectionUpdate);
  socket.off('game:reset', socket.__onGameReset);
  socket.off('game:redirect', socket.__onGameReset);
  socket.off('connect', socket.__onLobbyConnect);
}

function registerLobbySocketHandlers() {
  if (socketHandlersRegistered) return;

  const socket = getSocket();
  socketHandlersRegistered = true;
  lobbyBoundSocket = socket;

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
    releaseMainGameAutoEntryIfIdle();
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

  const onLobbyConnect = () => {
    register();
    if (state.selectedCartels.length > 0 && !hasPendingSelection()) {
      syncSelectionToServer();
    }
  };

  socket.__onLobbyTick = onLobbyTick;
  socket.__onGameStart = onGameStart;
  socket.__onSelectionUpdate = onSelectionUpdate;
  socket.__onGameReset = onGameReset;
  socket.__onLobbyConnect = onLobbyConnect;

  socket.on('game:lobby-tick', onLobbyTick);
  socket.on('game:started', onGameStart);
  socket.on('game_start', onGameStart);
  socket.on('game:start', onGameStart);
  socket.on('game:selection-update', onSelectionUpdate);
  socket.on('game:reset', onGameReset);
  socket.on('game:redirect', onGameReset);
  socket.on('connect', onLobbyConnect);

  if (socket.connected) {
    register();
  }

  logCountdown('socket-handlers-registered');
}

/** Re-attach lobby handlers after socket recycle (removeAllListeners). */
export function rebindLobbySocketHandlers() {
  const socket = getSocket();
  if (lobbyBoundSocket === socket && socketHandlersRegistered) {
    return;
  }
  if (lobbyBoundSocket) {
    unbindLobbySocketHandlers(lobbyBoundSocket);
  }
  socketHandlersRegistered = false;
  registerLobbySocketHandlers();
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

/** Synchronous lobby reset — called only from clearGameSession(). */
export function resetLobbySessionState() {
  selectionSyncGeneration += 1;
  selectionSyncInFlight = false;
  state.selectedCartels = [];
  state.takenCartels = new Set();
  state.cartelOwnership = {};
  state.gameInProgress = false;
  state.gameStatus = 'WAITING';
  state.selectionLocked = false;
  state.lobbyPhase = 'COUNTDOWN_RUNNING';
  state.countdownExpiredSignaled = false;
  gameStartNavigateDone = false;
  pendingReleaseCartels.clear();
  localSelectionDirty = false;
  state.lobbyRevision = 0;
  lastNotifyFingerprint = '';
  lastLocalCountdownRemaining = null;
  notify(true);
}

/** Async server sync after clearGameSession(); releases auto-entry block when idle. */
export function scheduleLobbyResyncAfterSessionClear() {
  void refreshFromApi({ replace: true }).finally(() => {
    releaseMainGameAutoEntryIfIdle();
  });
}

/** Async full lobby snapshot from server (replace local cache, no merge). */
export async function resyncLobbySnapshotForSession() {
  try {
    await refreshFromApi({ replace: true });
    return { ok: true };
  } catch (err) {
    console.warn('[game-init] LOBBY_SYNC failed', err?.message ?? err);
    return { ok: false, error: err?.message ?? 'lobby_sync_failed' };
  }
}

/** Lifecycle: stop the local lobby countdown ticker while backgrounded. */
export function pauseLobbyLocalTimers() {
  if (localTickTimer != null) {
    clearInterval(localTickTimer);
    localTickTimer = null;
    logCountdown('ticker-paused-background');
  }
}

/** Lifecycle: resume the local lobby countdown ticker after foreground. */
export function resumeLobbyLocalTimers() {
  ensureLocalCountdownTicker();
}

/** Lifecycle: refresh lobby state from REST + socket after foreground. */
export async function resyncLobbyFromServer({ replace = false } = {}) {
  const socket = getSocket();
  const userId = activeUserId();

  const apiPromise = refreshFromApi({ replace });

  if (socket.connected && userId) {
    socket.emit('game:lobby-sync', { userId, telegramId: userId }, (ack) => {
      if (ack?.ok !== false) {
        applyLobbyPayload(ack, {
          mergeCartels: !replace,
          mergeTaken: true,
          replace,
        });
        logCountdown('lobby-resync-foreground', { userId, replace });
      }
    });
  } else if (!socket.connected) {
    socket.connect();
  }

  await apiPromise;
}
