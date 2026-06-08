/**
 * Injects ON robots into the live lobby session (existing GameSession APIs only).
 */
const robotConfigService = require('./robotConfigService');
const robotManagementService = require('./robotManagementService');

function canRobotsJoinLobby(session) {
  return Boolean(
    session &&
      session.status === 'waiting' &&
      !session.stakesCharged
  );
}

function ensureRobotsJoinBeforeRoundStart(io, session, runtime) {
  if (!session || !io || !runtime) return 0;

  if (typeof session.ensureLobbyCountdownRunning === 'function') {
    session.ensureLobbyCountdownRunning();
  }

  const cfg = robotConfigService.getConfigSync();
  if (cfg.enabledGlobal !== true) {
    console.warn('[robots] global robot system disabled — skipping lobby join');
    return 0;
  }

  const robotBehavior = require('./robotBehaviorService');
  const joined = robotBehavior.syncAllActiveRobotsIntoSession(session, io, cfg, runtime, {
    eager: true,
    reason: 'pre_round_start',
  });

  if (joined > 0) {
    console.info('[robots] pre-start sync seated robots in main game', {
      gameId: session.gameId,
      room: session.roomName,
      joined,
      playersCount: session.playersCount,
    });
  }

  return joined;
}

async function syncActiveRobotsFromDb(runtime, refreshRuntimeFromRobots) {
  const active = await robotManagementService.listActiveRobotsForEngine();
  refreshRuntimeFromRobots(active);
  return active;
}

module.exports = {
  canRobotsJoinLobby,
  ensureRobotsJoinBeforeRoundStart,
  syncActiveRobotsFromDb,
};
