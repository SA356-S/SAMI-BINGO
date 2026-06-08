const { LOBBY_COUNTDOWN_SEC } = require('../config/constants');

/** Admin-adjustable range: 1–100 seconds */
const CARD_SELECTION_TIME_MIN_SEC = 1;
const CARD_SELECTION_TIME_MAX_SEC = 100;

function clampCardSelectionTime(seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n)) {
    return LOBBY_COUNTDOWN_SEC;
  }
  const rounded = Math.round(n);
  return Math.min(
    CARD_SELECTION_TIME_MAX_SEC,
    Math.max(CARD_SELECTION_TIME_MIN_SEC, rounded)
  );
}

/** Resolve stored value; legacy default when field is unset. */
function resolveCardSelectionTime(storedSeconds) {
  if (storedSeconds === undefined || storedSeconds === null) {
    return LOBBY_COUNTDOWN_SEC;
  }
  return clampCardSelectionTime(storedSeconds);
}

module.exports = {
  CARD_SELECTION_TIME_MIN_SEC,
  CARD_SELECTION_TIME_MAX_SEC,
  clampCardSelectionTime,
  resolveCardSelectionTime,
};
