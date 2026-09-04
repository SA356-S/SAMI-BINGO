/** Human cartela select/release closes when this many seconds (or fewer) remain. */
export const LOBBY_SELECTION_LOCK_REMAINING_SEC = 3;

export function isLobbySelectionFrozen(
  remaining,
  { selectionLocked = false, gameInProgress = false } = {}
) {
  if (selectionLocked || gameInProgress) return true;
  const sec = Number(remaining);
  return Number.isFinite(sec) && sec <= LOBBY_SELECTION_LOCK_REMAINING_SEC;
}
