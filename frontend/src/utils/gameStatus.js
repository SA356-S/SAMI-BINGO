/** Normalized lobby/game phase for navigation (matches backend contract). */
export const GAME_STATUS = {
  WAITING: 'WAITING',
  RUNNING: 'RUNNING',
  FINISHED: 'FINISHED',
};

/**
 * Map backend session status / flags to WAITING | RUNNING | FINISHED.
 */
export function normalizeGameStatus(payload = {}) {
  if (payload?.gameStatus) {
    const upper = String(payload.gameStatus).toUpperCase();
    if (upper === GAME_STATUS.RUNNING) return GAME_STATUS.RUNNING;
    if (upper === GAME_STATUS.FINISHED) return GAME_STATUS.FINISHED;
    if (upper === GAME_STATUS.WAITING) return GAME_STATUS.WAITING;
  }

  const raw = String(payload?.status ?? '').toLowerCase();
  if (raw === 'calling') return GAME_STATUS.RUNNING;
  if (raw === 'ended' || raw === 'finished') return GAME_STATUS.FINISHED;

  if (payload?.gameInProgress || payload?.lobbyPhase === 'GAME_STARTED') {
    return GAME_STATUS.RUNNING;
  }

  return GAME_STATUS.WAITING;
}

export function isGameRunning(payload = {}) {
  return normalizeGameStatus(payload) === GAME_STATUS.RUNNING;
}

export function hasEnoughCartelsToPlay(payload = {}, min = 2) {
  const cartels = payload?.myCartels ?? payload?.selectedCartels ?? [];
  if (!Array.isArray(cartels)) return false;
  return cartels.map(Number).filter((n) => n >= 1).length >= min;
}
