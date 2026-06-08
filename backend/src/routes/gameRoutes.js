const express = require('express');
const { gameManager } = require('../socket/gameManager');
const { getOrInitWallet } = require('../socket/walletManager');
const { GAME_ENTRY_STAKE } = require('../config/constants');
const {
  attachTelegramUserFromRequest,
  requireTelegramUserId,
} = require('../utils/telegramAuth');
const { rejectIfBanned } = require('../utils/banGate');

const router = express.Router();

router.use(attachTelegramUserFromRequest);

/**
 * GET /api/game/card-selection
 * Shape matches frontend api/cardSelection.js fetchGameData()
 */
router.get('/card-selection', requireTelegramUserId, async (req, res) => {
  const gameId = req.query.gameId;
  const userId = req.telegramUserId;

  const banned = await rejectIfBanned(userId, res);
  if (banned) return;
  const session = gameId
    ? gameManager.resolveGameplaySession(String(gameId))
    : gameManager.getLobbySession();

  const wallets = userId ? getOrInitWallet(String(userId)) : { main: 0, play: 0 };
  res.json(session.toCardSelectionPayload(wallets, userId));
});

/**
 * GET /api/game/main?gameId=
 * Shape matches frontend api/mainGame.js fetchMainGameData()
 */
router.get('/main', (req, res) => {
  const gameId = req.query.gameId;

  if (!gameId) {
    const lobby = gameManager.getLobbySession();
    return res.json({
      playersCount: lobby.playersCount,
      players: lobby.playersCount,
      derash: lobby.derash,
      pot: lobby.derash,
      calledNumbers: lobby.calledNumbers,
      called: lobby.calledNumbers,
      balls: lobby.calledNumbers,
      gameId: lobby.gameId,
    });
  }

  const session = gameManager.resolveGameplaySession(String(gameId));

  const state = session.toPublicState();
  res.json({
    playersCount: state.playersCount,
    players: state.players,
    derash: state.derash,
    pot: state.pot,
    calledNumbers: state.calledNumbers,
    called: state.called,
    balls: state.balls,
    latestBall: state.latestBall,
    gameId: state.gameId,
    status: state.status,
  });
});

/**
 * POST /api/game/session — create a new game id (optional helper for clients)
 */
router.post('/session', (req, res) => {
  const { gameId, stake } = req.body || {};
  const session = gameManager.createSession(
    gameId ? String(gameId) : null,
    { stake: stake != null ? Number(stake) : GAME_ENTRY_STAKE }
  );

  res.status(201).json({
    gameId: session.gameId,
    stake: session.stake,
    playersCount: 0,
    takenCartels: [...session.takenCartels],
  });
});

router.get('/sessions', (_req, res) => {
  res.json({ sessions: gameManager.listSessions() });
});

module.exports = router;
