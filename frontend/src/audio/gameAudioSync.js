import { getSocket } from '../api/socket';
import {
  playBallCallSoundAndWait,
  playBingoWinSound,
  playCountdownTickSound,
  playGameStartSound,
  prepareGameAudioForRound,
  resetAnnouncedBalls,
  resetBallSoundQueue,
  resetBingoWinSound,
  syncAnnouncedBallsFromHistory,
  unlockGameAudio,
  waitForBallAnnouncementIdle,
} from './gameSounds';

let syncEnabled = false;
let boundSocket = null;
let lastBallSequence = 0;
let activeGameId = null;

function matchesActiveGame(payload) {
  const incoming = payload?.gameId != null ? String(payload.gameId) : null;
  if (!incoming) return true;
  if (!activeGameId) {
    activeGameId = incoming;
    return true;
  }
  return incoming === activeGameId;
}

/** Align dedupe state after rejoin / snapshot sync (no audio replay). */
export function syncGameAudioFromSnapshot(payload = {}) {
  const incoming = payload?.gameId != null ? String(payload.gameId) : null;
  if (incoming) activeGameId = incoming;

  const seq = Number(payload?.sequence ?? payload?.calledCount);
  if (Number.isFinite(seq) && seq > 0) {
    lastBallSequence = Math.max(lastBallSequence, seq);
  }

  const balls =
    payload?.calledNumbers ??
    payload?.called ??
    payload?.balls ??
    payload?.calledHistory;
  if (Array.isArray(balls) && balls.length > 0) {
    syncAnnouncedBallsFromHistory(balls);
  }
}

function resetAudioSession() {
  lastBallSequence = 0;
  activeGameId = null;
  resetBallSoundQueue();
  resetBingoWinSound();
  resetAnnouncedBalls();
}

function handleBallAudioEvent(payload, eventName) {
  if (!matchesActiveGame(payload)) return;

  const n = Math.floor(Number(payload?.number ?? payload?.latestBall));
  if (!Number.isFinite(n) || n < 1 || n > 75) return;

  const seq = Number(payload?.sequence);
  if (Number.isFinite(seq) && seq > 0) {
    if (seq <= lastBallSequence) return;
    lastBallSequence = seq;
  }

  console.log('[bingo-audio] ball event received', {
    event: eventName,
    ball: n,
    sequence: payload?.sequence,
    gameId: payload?.gameId,
  });

  void playBallCallSoundAndWait(n, { source: eventName, forceLive: true }).catch((err) => {
    console.log('[bingo-audio] ball play failed:', err?.message || err);
  });
}

function unbindCurrentSocket() {
  if (!boundSocket) return;
  boundSocket.off('ball_called', boundSocket.__onBallCalled);
  boundSocket.off('newNumber', boundSocket.__onNewNumberBall);
  boundSocket.off('game_start_sound', boundSocket.__onGameStartSound);
  boundSocket.off('bingo_announce', boundSocket.__onBingoAnnounce);
  boundSocket.off('countdown_tick', boundSocket.__onCountdownTick);
  boundSocket.off('game:reset', boundSocket.__onGameReset);
  boundSocket.off('game:redirect', boundSocket.__onGameReset);
  boundSocket.off('connect', boundSocket.__onSocketConnect);
  boundSocket = null;
}

/** Attach audio handlers to the active socket (safe to call after reconnect). */
export function rebindGameAudioSync() {
  if (!syncEnabled) return;

  const socket = getSocket();
  if (boundSocket === socket) return;

  unbindCurrentSocket();
  boundSocket = socket;

  const onBallCalled = (payload) => handleBallAudioEvent(payload, 'ball_called');
  const onNewNumberBall = (payload) => {
    if (payload?.ballSync && payload.ballSync !== 'live') return;
    handleBallAudioEvent(payload, 'newNumber');
  };
  const onGameStartSound = (payload) => {
    if (!matchesActiveGame(payload)) return;
    void prepareGameAudioForRound().then(() => playGameStartSound());
  };
  const onBingoAnnounce = (payload) => {
    if (!matchesActiveGame(payload)) return;
    void playBingoWinSound().catch((err) => {
      console.log('[bingo-audio] bingo play failed:', err?.message || err);
    });
  };
  const onCountdownTick = (payload) => {
    if (!matchesActiveGame(payload)) return;
    const sec = Number(payload?.seconds ?? payload?.remaining);
    if (!Number.isFinite(sec)) return;
    void playCountdownTickSound(sec);
  };
  const onReset = () => resetAudioSession();
  const onSocketConnect = () => {
    void unlockGameAudio();
  };

  socket.__onBallCalled = onBallCalled;
  socket.__onNewNumberBall = onNewNumberBall;
  socket.__onGameStartSound = onGameStartSound;
  socket.__onBingoAnnounce = onBingoAnnounce;
  socket.__onCountdownTick = onCountdownTick;
  socket.__onGameReset = onReset;
  socket.__onSocketConnect = onSocketConnect;

  socket.on('ball_called', onBallCalled);
  socket.on('newNumber', onNewNumberBall);
  socket.on('game_start_sound', onGameStartSound);
  socket.on('bingo_announce', onBingoAnnounce);
  socket.on('countdown_tick', onCountdownTick);
  socket.on('game:reset', onReset);
  socket.on('game:redirect', onReset);
  socket.on('connect', onSocketConnect);

  if (socket.connected) {
    void unlockGameAudio();
  }
}

/**
 * App-wide socket audio — players and watching-only users share the same events.
 * @returns {() => void} cleanup
 */
export function initGameAudioSync() {
  if (syncEnabled) {
    rebindGameAudioSync();
    return () => {};
  }

  syncEnabled = true;
  rebindGameAudioSync();

  return () => {
    unbindCurrentSocket();
    syncEnabled = false;
  };
}

export { waitForBallAnnouncementIdle };
