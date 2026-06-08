/** Minimum cartelas a user must hold to enter main game as an active player */
export const MIN_CARTELAS_TO_ENTER_MAIN = 1;

/** @deprecated use MIN_CARTELAS_TO_ENTER_MAIN — kept for imports */
export const REQUIRED_CARTELS_TO_PLAY = MIN_CARTELAS_TO_ENTER_MAIN;
/**
 * Build /main-game navigation state from lobby selection (no watcher UI flags exposed).
 */
export function buildMainGameEntryState({
  selectedCartels = [],
  gameId = null,
  playersCount = 0,
  stake = 10,
} = {}) {
  const cartels = [...selectedCartels].map(Number).filter((n) => n >= 1);
  const canPlay = cartels.length >= MIN_CARTELAS_TO_ENTER_MAIN;
  if (canPlay) {
    return {
      selectedCartels: cartels,
      stake,
      gameId,
      playersCount,
      joinedFromSelection: true,
    };
  }

  return {
    watchingOnly: true,
    selectionLocked: true,
    selectedCartels: [],
    stake,
    gameId,
    playersCount,
  };
}

export function isLobbyGameStarted(lobby = {}) {
  return (
    Boolean(lobby.gameInProgress) ||
    lobby.lobbyPhase === 'GAME_STARTED' ||
    lobby.gameStatus === 'RUNNING'
  );
}
