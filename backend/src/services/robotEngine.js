const { gameManager } = require('../socket/gameManager');
const robotConfigService = require('./robotConfigService');
const robotManagementService = require('./robotManagementService');
const settingsService = require('./settingsService');
const robotBehavior = require('./robotBehaviorService');
const robotDrawAssist = require('./robotDrawAssist');
const { syncActiveRobotsFromDb } = require('./robotGameSessionBridge');
const { broadcastAdmin, emitGameStatus } = require('./adminService');

const TICK_MS = 1000;
const FETCH_ROBOTS_EVERY_MS = 3000;
const { runDeferred } = require('../utils/eventLoopDefer');

let intervalId = null;
let tickInFlight = false;

/** robotId -> runtime state */
const runtime = new Map();

let cachedActiveRobots = [];
let robotsFetchInFlight = false;
let lastRobotsFetchAt = 0;

let lastStakesCharged = false;

const state = {
  activeRoundCounter: 0,
  lastResolvedRoundId: 0,
  lastBingoEvalCalledLen: 0,
  lastOpsCapLogAt: 0,
};

function now() {
  return Date.now();
}

function ensureRuntimeEntry(robot) {
  const id = String(robot.robotId);
  const existing = runtime.get(id);
  if (existing) {
    existing.enabled = robot.status === 'on' || robot.enabled === true;
    existing.displayName = robot.name || existing.displayName;
    return existing;
  }
  const entry = robotBehavior.createRuntimeEntry(robot);
  entry.nextJoinAt = now();
  runtime.set(id, entry);
  return entry;
}

function refreshRuntimeFromRobots(robots) {
  const onIds = new Set();
  for (const r of robots) {
    onIds.add(String(r.robotId));
    ensureRuntimeEntry(r);
  }
  for (const rt of runtime.values()) {
    const wasEnabled = rt.enabled;
    rt.enabled = onIds.has(rt.robotId);
    if (rt.enabled && !wasEnabled) {
      rt.nextJoinAt = now();
      rt.nextLeaveAt = null;
    }
    if (!rt.enabled && rt.active) {
      rt.nextLeaveAt = now();
    }
  }
}

async function refreshActiveRobotsCache() {
  const list = await robotManagementService.listActiveRobotsForEngine();
  cachedActiveRobots = list || [];
  lastRobotsFetchAt = now();
  refreshRuntimeFromRobots(cachedActiveRobots);
  return cachedActiveRobots;
}

function tryFetchRobots() {
  const t = now();
  if (t - lastRobotsFetchAt < FETCH_ROBOTS_EVERY_MS) return;
  if (robotsFetchInFlight) return;

  robotsFetchInFlight = true;
  syncActiveRobotsFromDb(runtime, refreshRuntimeFromRobots)
    .then((list) => {
      cachedActiveRobots = list || [];
      lastRobotsFetchAt = t;
    })
    .catch((err) => {
      console.warn('[robots] list failed:', err?.message || err);
      cachedActiveRobots = robotManagementService.listActiveRobotsForEngineSync();
      refreshRuntimeFromRobots(cachedActiveRobots);
    })
    .finally(() => {
      robotsFetchInFlight = false;
    });
}

function robotEngineTick(io) {
  const session = gameManager.getLobbySession();
  if (!session) return;

  tryFetchRobots();
  refreshRuntimeFromRobots(
    cachedActiveRobots.length
      ? cachedActiveRobots
      : robotManagementService.listActiveRobotsForEngineSync()
  );

  const cfg = robotConfigService.getConfigSync();

  for (const rt of runtime.values()) {
    if (session.players.has(rt.pseudoSocketId)) {
      if (now() - (rt.lastEventAt || 0) > 2000 || !rt.currentRoundCartels?.length) {
        robotBehavior.syncCartelsFromSession(session, rt);
      }
    } else if (rt.enabled) {
      if (!rt.nextJoinAt || rt.nextJoinAt > now()) {
        rt.nextJoinAt = now();
      }
    } else {
      rt.active = false;
      rt.currentRoundCartels = [];
      rt.paidForRound = false;
      rt.claimedForRound = false;
      rt.currentRoundId = 0;
    }
  }

  if (session.status === 'waiting' && !session.stakesCharged) {
    robotBehavior.syncAllActiveRobotsIntoSession(session, io, cfg, runtime, {
      eager: true,
    });
  }

  if (session.status === 'calling' && session.stakesCharged && !lastStakesCharged) {
    const advantageLevel = resolveActiveAdvantageLevel(session);
    const roundId = robotBehavior.markPaidRobotsIfStakesCharged(
      session,
      runtime,
      state,
      advantageLevel
    );
    broadcastAdmin('admin:robotActivity', {
      type: 'round_started',
      gameId: session.gameId,
      roundId,
      at: new Date().toISOString(),
    });
    emitGameStatus(session);
  }
  lastStakesCharged = Boolean(session.stakesCharged);

  if (session.status === 'ended') {
    robotBehavior.tryResolveRoundOutcome(
      io,
      session,
      runtime,
      state,
      state.activeRoundCounter,
      session.winner?.socketId ?? null,
      cfg
    );
    return;
  }

  if (robotBehavior.canRobotsJoinLobby(session)) {
    robotBehavior.runLobbyTick(session, io, cfg, runtime, state);
  }

  if (session.status === 'calling') {
    const advantageLevel = resolveActiveAdvantageLevel(session);
    robotBehavior.tryEvaluateBingos(io, session, cfg, runtime, state, advantageLevel);
  }
}

/**
 * Called from the main game ball draw loop immediately after each newNumber.
 * Ensures robot wins use the same declareWinner path as real players without waiting for the 1s tick.
 */
function evaluateRobotsAfterBallDraw(io, session) {
  if (!session || session.status !== 'calling' || session.resetTimer) return;
  if (session.winner || session._winnerLocked) return;

  const cfg = robotConfigService.getConfigSync();
  if (!robotBehavior.hasEnabledRobotsInRound(session, runtime, cfg)) return;

  if (session.stakesCharged && !lastStakesCharged) {
    prepareRobotsForCallingRound(session);
  }

  const advantageLevel = resolveActiveAdvantageLevel(session);
  robotBehavior.tryEvaluateBingos(io, session, cfg, runtime, state, advantageLevel);
}

/**
 * Prepare paid robots + draw plan before the first ball of a calling round.
 * Must run synchronously when calling starts (before callNextBall).
 */
function resolveActiveAdvantageLevel(session) {
  const fromSettings = settingsService.getRobotAdvantageLevelSync();
  if (fromSettings > 0) return fromSettings;
  const plan = robotDrawAssist.getRoundPlan(session?.gameId);
  if (plan?.advantageLevel > 0) return plan.advantageLevel;
  return fromSettings;
}

function prepareRobotsForCallingRound(session) {
  if (!session || session.status !== 'calling' || !session.stakesCharged) return;
  if (lastStakesCharged) return;

  refreshRuntimeFromRobots(
    cachedActiveRobots.length
      ? cachedActiveRobots
      : robotManagementService.listActiveRobotsForEngineSync()
  );

  const advantageLevel = resolveActiveAdvantageLevel(session);

  robotBehavior.markPaidRobotsIfStakesCharged(
    session,
    runtime,
    state,
    advantageLevel
  );

  lastStakesCharged = true;
}

robotDrawAssist.installDrawAssist(
  () => gameManager.getLobbySession(),
  () => runtime
);

function startRobotEngine(io) {
  if (intervalId) return;

  void robotConfigService.getConfig().catch(() => {});
  void settingsService.getSettings().catch(() => {});
  void refreshActiveRobotsCache().catch((err) => {
    console.warn('[robots] initial cache load failed:', err?.message || err);
  });

  intervalId = setInterval(() => {
    if (tickInFlight) return;
    tickInFlight = true;
    runDeferred(() => {
      try {
        robotEngineTick(io);
      } catch (err) {
        console.warn('[robots] engine tick failed:', err?.message || err);
      } finally {
        tickInFlight = false;
      }
    });
  }, TICK_MS);

  console.log('[robots] robotEngine started');
}

function getRuntimeMap() {
  return runtime;
}

module.exports = {
  startRobotEngine,
  refreshActiveRobotsCache,
  getRuntimeMap,
  evaluateRobotsAfterBallDraw,
  prepareRobotsForCallingRound,
};
