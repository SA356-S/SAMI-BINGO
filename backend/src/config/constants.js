/** Ball draw interval — 4s (within 3–5s spec) */
const BALL_INTERVAL_MS = 4000;

/** Matches frontend CardSelection / MainGame GAME_ENTRY_STAKE */
const GAME_ENTRY_STAKE = 10;

/** House commission on total cartel pool at game start (20%) */
const HOUSE_COMMISSION_RATE = 0.2;

const MIN_PLAYERS = 2;
// Allow up to 10 cartelas per player (robots + humans).
const MAX_CARTELS_PER_PLAYER = 10;
// Minimum total cartelas across all players (robots + users) to start a round.
const MIN_TOTAL_CARTELAS_TO_START = 2;
/** Minimum cartelas for a seated player/robot to participate in calling and claim bingo. */
const MIN_CARTELAS_TO_PLAY = 1;

/** Game id format: DB-XXXXXXXX (MainGame.jsx) */
const GAME_ID_PREFIX = 'DB-';

const ID_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Winner screen duration before game:reset (matches frontend WinnerAnnouncement) */
const ROUND_END_DISPLAY_MS = 6000;

/** Global card-selection lobby countdown (seconds) */
const LOBBY_COUNTDOWN_SEC = 45;

/** Lobby phases before/during synchronized game start */
const LOBBY_PHASE = {
  WAITING: 'WAITING',
  COUNTDOWN_RUNNING: 'COUNTDOWN_RUNNING',
  GAME_STARTED: 'GAME_STARTED',
};

module.exports = {
  BALL_INTERVAL_MS,
  GAME_ENTRY_STAKE,
  HOUSE_COMMISSION_RATE,
  MIN_PLAYERS,
  MAX_CARTELS_PER_PLAYER,
  MIN_TOTAL_CARTELAS_TO_START,
  MIN_CARTELAS_TO_PLAY,
  GAME_ID_PREFIX,
  ID_CHARS,
  ROUND_END_DISPLAY_MS,
  LOBBY_COUNTDOWN_SEC,
  LOBBY_PHASE,
};
