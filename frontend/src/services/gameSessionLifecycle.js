import {
  ensureSocketConnectedWithRetry,
  normalizeCalledNumbers,
} from '../api/socket';
import { getPlayerUserId } from '../api/playerIdentity';
import { joinAsWatcher } from '../api/gameSession';
import { normalizeGameStatus, GAME_STATUS } from '../utils/gameStatus';
import {
  prepareGameAudioForRound,
  resetBallSoundQueue,
  unlockGameAudio,
} from '../audio/gameSounds';
import {
  rebindGameAudioSync,
  resetGameAudioForEntry,
  syncGameAudioFromSnapshot,
} from '../audio/gameAudioSync';
import {
  rebindLobbySocketHandlers,
  resetLobbySessionState,
  resyncLobbySnapshotForSession,
  scheduleLobbyResyncAfterSessionClear,
} from './lobbySession';

const JOIN_ACK_TIMEOUT_MS = 12000;

/** @type {(() => void) | null} */
let mainGameSessionReset = null;

/** All session lifecycle flags live here — single source of truth. */
const session = {
  generation: 0,
  /** True while initializeGameSession() is running. */
  busy: false,
  /** True after clearGameSession() until lobby confirms idle. */
  blockAutoEntry: false,
};

function logInit(phase, detail = {}) {
  console.log(`[game-init] ${phase}`, detail);
}

export function isMainGameAutoEntryBlocked() {
  return session.blockAutoEntry;
}

export function releaseMainGameAutoEntry() {
  session.blockAutoEntry = false;
}

/** Gate for lobby auto-navigation to MainGame. */
export function canAutoNavigateToMainGame() {
  return !session.blockAutoEntry && !session.busy;
}

export function registerMainGameSessionReset(handler) {
  mainGameSessionReset = handler;
  return () => {
    if (mainGameSessionReset === handler) {
      mainGameSessionReset = null;
    }
  };
}

export function invalidateGameSessionGeneration() {
  session.generation += 1;
  return session.generation;
}

export function isActiveGameSessionGeneration(generation) {
  return generation === session.generation;
}

export function shouldFallbackToCardSelection(result) {
  return Boolean(result && !result.ok && !result.aborted && result.error);
}

function emitWithAck(socket, event, payload) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ack) => {
      if (settled) return;
      settled = true;
      resolve(ack ?? { ok: false });
    };
    const timer = setTimeout(
      () => finish({ ok: false, error: 'timeout' }),
      JOIN_ACK_TIMEOUT_MS
    );
    socket.emit(event, payload, (ack) => {
      clearTimeout(timer);
      finish(ack);
    });
  });
}

function applyJoinSnapshot(ack, handlers, ballSource, generation) {
  if (!isActiveGameSessionGeneration(generation)) return false;
  if (ack?.ok === false) return false;

  handlers.adoptGameId?.(ack);
  handlers.applyServerSnapshot?.(ack);
  handlers.applyBallDraw?.(ack, ballSource);
  handlers.applyPendingWinner?.(ack);

  const balls = normalizeCalledNumbers(ack);
  syncGameAudioFromSnapshot({
    gameId: ack?.gameId,
    calledNumbers: balls,
    sequence: ack?.sequence ?? ack?.calledCount ?? balls.length,
  });

  if (ack.manualMarks && handlers.setManualMarks) {
    handlers.setManualMarks(ack.manualMarks);
  }
  if (typeof ack.automatic === 'boolean' && handlers.setAutomatic) {
    handlers.setAutomatic(ack.automatic);
  }

  return true;
}

function prepareBindings(gameId) {
  resetGameAudioForEntry(gameId);
  resetBallSoundQueue();
  rebindLobbySocketHandlers();
  rebindGameAudioSync();
}

async function runGameJoinFlow({
  mode,
  gameId,
  cartels,
  stake,
  handlers,
  generation,
  socket,
}) {
  const userId = getPlayerUserId();
  const joinCartels = [...cartels].map(Number).filter((n) => n >= 1);
  const sessionGameId = gameId ?? null;

  const syncSession = async (targetGameId) => {
    if (!targetGameId) return { ok: false };
    const ack = await emitWithAck(socket, 'game:state', { gameId: targetGameId });
    if (applyJoinSnapshot(ack, handlers, 'game:sync', generation)) {
      return { ok: true, ack };
    }
    return { ok: false, ack };
  };

  if (mode === 'rejoin') {
    const ack = await emitWithAck(socket, 'game:rejoin', {
      gameId: sessionGameId,
      userId,
      playerName: userId,
    });

    if (!isActiveGameSessionGeneration(generation)) {
      return { ok: false, aborted: true, generation };
    }
    if (ack?.ok === false) {
      return { ok: false, generation, error: ack.error ?? 'rejoin_failed', ack };
    }

    const cartelList = (ack.myCartels ?? ack.selectedCartels ?? joinCartels).map(
      Number
    );
    if (cartelList.length > 0) {
      handlers.updateSessionCartels?.(cartelList);
      handlers.setMyCartels?.(cartelList);
    }

    applyJoinSnapshot(ack, handlers, 'game:rejoin', generation);
    return { ok: true, generation, ack };
  }

  if (mode === 'join') {
    const ack = await emitWithAck(socket, 'game:join', {
      gameId: sessionGameId ?? undefined,
      selectedCartels: joinCartels,
      cartelIds: joinCartels,
      cartels: joinCartels,
      playerName: userId,
      userId,
      stake,
      autoStart: false,
      startRound: false,
    });

    if (!isActiveGameSessionGeneration(generation)) {
      return { ok: false, aborted: true, generation };
    }
    if (ack?.ok === false) {
      return { ok: false, generation, error: ack.error ?? 'join_failed', ack };
    }

    handlers.adoptGameId?.(ack);
    handlers.applyServerSnapshot?.(ack);

    const resolvedGameId = ack?.gameId ?? sessionGameId;
    const joinBalls = normalizeCalledNumbers(ack);
    const gameStatus = normalizeGameStatus(ack);
    const roundRunning =
      gameStatus === GAME_STATUS.RUNNING ||
      ack?.status === 'calling' ||
      ack?.alreadyStarted === true;

    if (joinBalls.length > 0) {
      applyJoinSnapshot(ack, handlers, 'game:rejoin', generation);
    } else {
      handlers.applyPendingWinner?.(ack);
    }

    if (!roundRunning && joinBalls.length === 0) {
      await syncSession(resolvedGameId);
    }

    if (
      !roundRunning &&
      ack?.status === 'waiting' &&
      joinCartels.length > 0 &&
      resolvedGameId
    ) {
      const startAck = await emitWithAck(socket, 'game:round-start', {
        gameId: resolvedGameId,
        selectedCartels: joinCartels,
        cartelIds: joinCartels,
        playerName: userId,
        userId,
        forceStart: true,
      });

      if (!isActiveGameSessionGeneration(generation)) {
        return { ok: false, aborted: true, generation };
      }
      if (startAck?.ok === false) {
        return { ok: true, generation, ack, roundStartFailed: true };
      }

      await prepareGameAudioForRound();
      applyJoinSnapshot(startAck, handlers, 'game:sync', generation);
      return { ok: true, generation, ack: startAck };
    }

    syncGameAudioFromSnapshot({
      gameId: resolvedGameId,
      calledNumbers: joinBalls,
      sequence: ack?.sequence ?? ack?.calledCount ?? joinBalls.length,
    });

    return { ok: true, generation, ack };
  }

  if (mode === 'watch') {
    const ack = await joinAsWatcher(userId, sessionGameId);

    if (!isActiveGameSessionGeneration(generation)) {
      return { ok: false, aborted: true, generation };
    }
    if (ack?.ok === false) {
      return { ok: false, generation, error: ack.error ?? 'watch_failed', ack };
    }

    applyJoinSnapshot(ack, handlers, 'game:sync', generation);
    return { ok: true, generation, ack };
  }

  if (mode === 'sync') {
    const result = await syncSession(sessionGameId);
    if (result.ok) {
      return { ok: true, generation, ack: result.ack };
    }
    return { ok: false, generation, error: 'sync_failed', ack: result.ack };
  }

  return { ok: false, generation, error: 'unknown_mode' };
}

/**
 * Single entry point for MainGame session start.
 * Flow: bindings → lobby sync → audio → socket → join.
 */
export async function initializeGameSession({
  mode = 'none',
  gameId = null,
  cartels = [],
  stake = 10,
  handlers = {},
} = {}) {
  if (session.busy) {
    logInit('INIT_SKIPPED', { reason: 'busy' });
    return { ok: false, skipped: true, reason: 'busy' };
  }

  session.busy = true;
  const generation = invalidateGameSessionGeneration();
  logInit('INIT_START', { mode, gameId });

  try {
    prepareBindings(gameId);

    if (!isActiveGameSessionGeneration(generation)) {
      return { ok: false, aborted: true, generation };
    }

    const lobbyResult = await resyncLobbySnapshotForSession();
    if (lobbyResult.ok) {
      logInit('LOBBY_SYNCED');
    } else {
      logInit('INIT_FAILED', { step: 'lobby', reason: lobbyResult.error });
    }

    await unlockGameAudio();
    await prepareGameAudioForRound();
    logInit('AUDIO_READY');

    if (!isActiveGameSessionGeneration(generation)) {
      return { ok: false, aborted: true, generation };
    }

    if (mode === 'none') {
      logInit('INIT_COMPLETE', { mode: 'none' });
      return { ok: true, generation, skipped: true };
    }

    logInit('SOCKET_CONNECTING');
    const socket = await ensureSocketConnectedWithRetry();
    if (!socket) {
      logInit('INIT_FAILED', { step: 'socket', reason: 'socket_connect_failed' });
      return { ok: false, generation, error: 'socket_connect_failed' };
    }
    logInit('SOCKET_READY');

    const joinResult = await runGameJoinFlow({
      mode,
      gameId,
      cartels,
      stake,
      handlers,
      generation,
      socket,
    });

    if (!isActiveGameSessionGeneration(generation)) {
      return { ok: false, aborted: true, generation };
    }

    if (joinResult.ok) {
      logInit('INIT_COMPLETE', { mode });
      return joinResult;
    }

    logInit('INIT_FAILED', {
      step: 'join',
      mode,
      reason: joinResult.error ?? 'join_failed',
    });
    return joinResult;
  } catch (err) {
    logInit('INIT_FAILED', { reason: err?.message ?? String(err) });
    return { ok: false, error: err?.message ?? 'init_failed' };
  } finally {
    session.busy = false;
  }
}

/**
 * Single exit/reset point after round end or before a fresh entry.
 */
export function clearGameSession() {
  session.blockAutoEntry = true;
  session.busy = false;
  invalidateGameSessionGeneration();
  mainGameSessionReset?.();
  resetLobbySessionState();
  resetBallSoundQueue();
  resetGameAudioForEntry(null);
  scheduleLobbyResyncAfterSessionClear();
}
