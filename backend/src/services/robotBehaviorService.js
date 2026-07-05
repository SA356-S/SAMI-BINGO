/**
 * Robot behavior overlay — timing, lobby actions, and claims only.
 * Uses existing GameSession APIs and validateBingoClaim; does not implement bingo rules.
 */
const { LOBBY_PHASE, MAX_CARTELS_PER_PLAYER, MIN_CARTELAS_TO_PLAY } = require('../config/constants');
const { validateBingoClaim, getCartelMarkedKeys } = require('../utils/bingoWin');
const {
  clampRobotAdvantageLevel,
  getRobotTargetWinBallCount,
  getRobotClaimDelayMs,
} = require('../utils/robotAdvantage');
const robotDrawAssist = require('./robotDrawAssist');
const robotBankService = require('./robotBankService');
const robotStatsService = require('./robotStatsService');
const { broadcastAdmin, emitGameStatus } = require('./adminService');
const {
  trackRobotRoomMember,
  untrackRobotRoomMember,
} = require('./robotRoomRegistry');
const settingsService = require('./settingsService');

/** Seconds after lobby countdown starts before any robot may select (45s → join at ≤38s left). */
const ROBOT_LOBBY_JOIN_DELAY_AFTER_COUNTDOWN_START_SEC = 7;
/** Per-robot spread so selections do not happen at the same instant (45s → 38–34s left). */
const ROBOT_LOBBY_JOIN_TIMING_SPREAD_SEC = 4;
/** Lock robot cartela join/leave/reselect when countdown has this many seconds or fewer left. */
const ROBOT_LOBBY_CARTELA_FREEZE_REMAINING_SEC = 10;

function now() {
  return Date.now();
}

function isSelectionOpen(session) {
  return (
    session?.status === 'waiting' &&
    session?.lobbyPhase === LOBBY_PHASE.COUNTDOWN_RUNNING &&
    session?.stakesCharged === false
  );
}

/** Lobby open for robot seating — any pre-start waiting phase (not only countdown label). */
function canRobotsJoinLobby(session) {
  return Boolean(
    session &&
      session.status === 'waiting' &&
      !session.stakesCharged
  );
}

/** True during the final lobby seconds — robots keep cartelas; no join/leave/reselect. */
function isRobotLobbyCartelaSelectionFrozen(session, options = {}) {
  if (options.forceBeforeRoundStart === true) return false;
  if (!canRobotsJoinLobby(session)) return false;
  if (typeof session.getLobbyCountdownRemaining !== 'function') return false;
  return (
    session.getLobbyCountdownRemaining() <= ROBOT_LOBBY_CARTELA_FREEZE_REMAINING_SEC
  );
}

function clampCartelCount(n) {
  const v = Math.max(1, Math.floor(Number(n) || 1));
  return Math.min(v, MAX_CARTELS_PER_PLAYER);
}

function randomInt(min, max) {
  const a = Math.floor(Number(min) || 0);
  const b = Math.floor(Number(max) || a);
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  if (hi <= lo) return lo;
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

function pickRobotJoinRemainingTarget(totalSec) {
  const total = Math.max(
    1,
    Math.floor(Number(totalSec) || settingsService.getCardSelectionTimeSync())
  );
  const maxRemaining = Math.max(
    1,
    total - ROBOT_LOBBY_JOIN_DELAY_AFTER_COUNTDOWN_START_SEC
  );
  const minRemaining = Math.max(
    1,
    maxRemaining - ROBOT_LOBBY_JOIN_TIMING_SPREAD_SEC
  );
  return randomInt(minRemaining, maxRemaining);
}

function needsRobotJoinReschedule(rt, session) {
  const endsAt = session?.lobbyCountdownEndsAt ?? null;
  return endsAt != null && rt._joinCountdownEndsAt !== endsAt;
}

function scheduleRobotLobbyJoin(rt, session) {
  if (!session || session.status !== 'waiting' || session.stakesCharged) {
    return;
  }

  if (
    !needsRobotJoinReschedule(rt, session) &&
    rt._joinWhenRemainingSec != null &&
    rt.nextJoinAt != null
  ) {
    return;
  }

  const totalSec = settingsService.getCardSelectionTimeSync();
  const targetRemaining = pickRobotJoinRemainingTarget(totalSec);
  rt._joinWhenRemainingSec = targetRemaining;
  rt._joinCountdownEndsAt = session.lobbyCountdownEndsAt ?? null;

  const remaining =
    typeof session.getLobbyCountdownRemaining === 'function'
      ? session.getLobbyCountdownRemaining()
      : totalSec;

  if (remaining <= targetRemaining) {
    rt.nextJoinAt = now();
  } else {
    rt.nextJoinAt = now() + (remaining - targetRemaining) * 1000;
  }
}

function isRobotLobbyJoinDue(session, rt, options = {}) {
  if (options.forceBeforeRoundStart === true) return true;
  if (isRobotLobbyCartelaSelectionFrozen(session, options)) return false;
  if (!canRobotsJoinLobby(session)) return false;
  if (
    session.lobbyPhase &&
    session.lobbyPhase !== LOBBY_PHASE.COUNTDOWN_RUNNING
  ) {
    return false;
  }

  if (typeof session.getLobbyCountdownRemaining !== 'function') return false;

  const remaining = session.getLobbyCountdownRemaining();
  if (remaining <= 0) return false;

  if (needsRobotJoinReschedule(rt, session) || rt._joinWhenRemainingSec == null) {
    scheduleRobotLobbyJoin(rt, session);
  }

  const maxRemainingAllowed = Math.max(
    1,
    settingsService.getCardSelectionTimeSync() -
      ROBOT_LOBBY_JOIN_DELAY_AFTER_COUNTDOWN_START_SEC
  );
  if (remaining > maxRemainingAllowed) return false;
  if (remaining > rt._joinWhenRemainingSec) return false;
  if (rt.nextJoinAt != null && now() < rt.nextJoinAt) return false;

  return true;
}

function pickAvailableCartels(session, count) {
  const want = clampCartelCount(count);
  const taken = session.takenCartels;
  const out = [];
  const used = new Set();
  const maxAttempts = Math.max(150, want * 200);
  let attempts = 0;

  while (out.length < want && attempts < maxAttempts) {
    attempts += 1;
    const id = 1 + Math.floor(Math.random() * 400);
    if (taken.has(id)) continue;
    if (used.has(id)) continue;
    used.add(id);
    out.push(id);
  }

  return out;
}

/**
 * Read-only: existing game winPercent (if present on session). Never written here.
 */
function readSessionWinPercent(session) {
  const raw = session?.winPercent ?? session?.win_percent;
  if (raw == null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, n));
}

function isRobotPseudoSocketId(socketId) {
  return String(socketId || '').startsWith('robot-sock:');
}

function getSeatedRobotCartels(session, rt) {
  const player = session?.players?.get?.(rt.pseudoSocketId);
  if (player?.cartelIds?.length) return [...player.cartelIds];
  if (rt.currentRoundCartels?.length) return [...rt.currentRoundCartels];
  return [];
}

function isParticipatingRobot(session, rt) {
  if (!session || !rt) return false;
  if (!isRobotPseudoSocketId(rt.pseudoSocketId)) return false;
  return getSeatedRobotCartels(session, rt).length >= MIN_CARTELAS_TO_PLAY;
}

/** True when robot system is active and at least one enabled robot is seated in this round. */
function hasEnabledRobotsInRound(session, runtime, cfg) {
  if (cfg?.enabledGlobal !== true || !session) return false;

  for (const rt of runtime.values()) {
    if (isParticipatingRobot(session, rt) && rt.enabled) return true;
  }

  for (const socketId of session.players.keys()) {
    if (!isRobotPseudoSocketId(socketId)) continue;
    const player = session.players.get(socketId);
    if ((player?.cartelIds?.length ?? 0) >= MIN_CARTELAS_TO_PLAY) return true;
  }

  return false;
}

function syncRobotCartelsForRound(session, rt) {
  if (!session?.players.has(rt.pseudoSocketId)) return rt.currentRoundCartels ?? [];
  return syncCartelsFromSession(session, rt);
}

function createRuntimeEntry(robot) {
  const id = String(robot.robotId);
  return {
    robotId: id,
    enabled: robot.status === 'on' || robot.enabled === true,
    displayName: robot.name || robot.displayName || id,
    username: robot.username || '',
    pseudoSocketId: `robot-sock:${id}`,
    nextJoinAt: null,
    _joinWhenRemainingSec: null,
    _joinCountdownEndsAt: null,
    nextLeaveAt: null,
    active: false,
    currentRoundCartels: [],
    paidForRound: false,
    claimedForRound: false,
    currentRoundId: 0,
    lastEventAt: 0,
    markedCalledCount: 0,
    lastMarkAt: 0,
    lastPatternCheckAt: 0,
    pendingClaim: null,
    targetWinBallCount: null,
  };
}

function findRobotByPseudoSocketId(runtime, pseudoSocketId) {
  for (const rt of runtime.values()) {
    if (rt.pseudoSocketId === pseudoSocketId) return rt;
  }
  return null;
}

function syncCartelsFromSession(session, rt) {
  const player = session.players.get(rt.pseudoSocketId);
  const cartels = player?.cartelIds ? [...player.cartelIds] : [];
  rt.currentRoundCartels = cartels;
  rt.active = cartels.length > 0;
  return cartels;
}

function emitPlayersUpdate(io, session) {
  try {
    io.to(session.roomName).emit('game:players', {
      gameId: session.gameId,
      playersCount: session.playersCount,
      players: session.buildPlayersList(),
    });
  } catch {
    /* ignore */
  }
}

function tryJoin(session, io, rt, cfg, runtime, activeCountFn, options = {}) {
  if (!canRobotsJoinLobby(session)) return false;
  if (!rt.enabled) return false;
  if (cfg.enabledGlobal !== true) return false;

  const player = session.players.get(rt.pseudoSocketId);
  if (player?.cartelIds?.length) {
    rt.active = true;
    rt.currentRoundCartels = [...player.cartelIds];
    trackRobotRoomMember(session, rt);
    return true;
  }

  if (rt.active && rt.currentRoundCartels?.length) return true;
  if (isRobotLobbyCartelaSelectionFrozen(session, options)) return false;
  if (!isRobotLobbyJoinDue(session, rt, options)) {
    scheduleRobotLobbyJoin(rt, session);
    return false;
  }
  if (typeof activeCountFn === 'function' && activeCountFn() >= cfg.maxActiveRobots) {
    return false;
  }

  if (typeof session.ensureLobbyCountdownRunning === 'function') {
    session.ensureLobbyCountdownRunning();
  }

  const count = randomInt(cfg.minCards, cfg.maxCards);
  const cartelIds = pickAvailableCartels(session, count);
  if (!cartelIds.length) {
    console.warn('[robots] no cartelas available for robot', rt.robotId);
    return false;
  }

  const res = session.assignCartels(
    rt.pseudoSocketId,
    cartelIds,
    rt.displayName,
    rt.robotId
  );
  if (!res?.ok) {
    console.warn('[robots] assignCartels failed', {
      robotId: rt.robotId,
      name: rt.displayName,
      error: res?.error,
    });
    return false;
  }

  rt.active = true;
  rt.currentRoundCartels = [...cartelIds];
  rt.paidForRound = false;
  rt.claimedForRound = false;
  rt.lastEventAt = now();

  trackRobotRoomMember(session, rt);

  console.info('[robots] Robot joined game:', rt.displayName, {
    robotId: rt.robotId,
    gameId: session.gameId,
    room: session.roomName,
    cartelIds,
  });
  console.info('[robots] Robot added to active players', {
    playersCount: session.playersCount,
    pseudoSocketId: rt.pseudoSocketId,
  });

  const leaveDelayBase =
    cfg.leaveJitterMs * (cfg.activityLevel > 0 ? 1 / cfg.activityLevel : 1);
  rt.nextLeaveAt = now() + Math.max(2000, Math.floor(Math.random() * leaveDelayBase));
  rt.nextJoinAt = null;

  try {
    session.emitLobbySelectionUpdate(io);
  } catch {
    /* ignore */
  }
  emitPlayersUpdate(io, session);
  emitGameStatus(session);

  broadcastAdmin('admin:robotActivity', {
    type: 'join',
    robotId: rt.robotId,
    pseudoSocketId: rt.pseudoSocketId,
    gameId: session.gameId,
    at: new Date().toISOString(),
    cartelIds: [...cartelIds],
  });

  return true;
}

function tryLeave(session, io, rt, cfg) {
  if (!canRobotsJoinLobby(session)) return;
  if (isRobotLobbyCartelaSelectionFrozen(session)) return;

  if (!rt.enabled) {
    if (!rt.active) return;
    session.removePlayer(rt.pseudoSocketId);
    untrackRobotRoomMember(session, rt);
    rt.active = false;
    rt.currentRoundCartels = [];
    rt.paidForRound = false;
    rt.claimedForRound = false;
    rt._joinWhenRemainingSec = null;
    rt._joinCountdownEndsAt = null;
    rt.nextJoinAt = null;
    rt.nextLeaveAt = null;
    emitGameStatus(session);
    emitPlayersUpdate(io, session);
    broadcastAdmin('admin:robotActivity', {
      type: 'disable_leave',
      robotId: rt.robotId,
      gameId: session.gameId,
      at: new Date().toISOString(),
    });
    return;
  }

  if (!rt.active) return;
  if (rt.nextLeaveAt == null || now() < rt.nextLeaveAt) return;
  if (cfg.enabledGlobal !== true) return;

  session.removePlayer(rt.pseudoSocketId);
  untrackRobotRoomMember(session, rt);
  rt.active = false;
  rt.currentRoundCartels = [];
  rt.paidForRound = false;
  rt.claimedForRound = false;
  rt._joinWhenRemainingSec = null;
  rt._joinCountdownEndsAt = null;
  rt.nextJoinAt = null;
  rt.nextLeaveAt = null;
  rt.lastEventAt = now();

  try {
    session.emitLobbySelectionUpdate(io);
  } catch {
    /* ignore */
  }
  emitPlayersUpdate(io, session);
  emitGameStatus(session);

  broadcastAdmin('admin:robotActivity', {
    type: 'leave',
    robotId: rt.robotId,
    gameId: session.gameId,
    at: new Date().toISOString(),
  });
}

function maybeAssignCartelsForActiveButEmpty(session, io, rt, cfg) {
  if (!canRobotsJoinLobby(session)) return;
  if (isRobotLobbyCartelaSelectionFrozen(session)) return;
  if (!rt.enabled) return;
  if (cfg.enabledGlobal !== true) return;
  if ((rt.currentRoundCartels || []).length > 0) return;

  const count = randomInt(cfg.minCards, cfg.maxCards);
  const cartelIds = pickAvailableCartels(session, count);
  if (!cartelIds.length) return;

  const res = session.assignCartels(
    rt.pseudoSocketId,
    cartelIds,
    rt.displayName,
    rt.robotId
  );
  if (!res?.ok) return;

  rt.currentRoundCartels = [...cartelIds];
  rt.active = true;
  rt.paidForRound = false;
  rt.claimedForRound = false;
  rt.lastEventAt = now();

  try {
    session.emitLobbySelectionUpdate(io);
  } catch {
    /* ignore */
  }
  emitPlayersUpdate(io, session);
}

function resetRobotRoundTiming(rt, t = now()) {
  rt.markedCalledCount = 0;
  rt.lastMarkAt = t;
  rt.lastPatternCheckAt = 0;
  rt.pendingClaim = null;
  rt.targetWinBallCount = null;
}

function advanceRobotMarking(rt, session, advantageLevel, t) {
  const calledLen = session.calledNumbers.length;
  if (calledLen <= 0) return;

  rt.targetWinBallCount = getRobotTargetWinBallCount(advantageLevel, rt.robotId);

  if (rt.targetWinBallCount == null) {
    if (rt.markedCalledCount > calledLen) {
      rt.markedCalledCount = calledLen;
    }
    if (rt.markedCalledCount >= calledLen) return;

    const elapsed = t - (rt.lastMarkAt || 0);
    if (elapsed < 1000) return;

    const behind = calledLen - rt.markedCalledCount;
    rt.markedCalledCount += Math.min(behind, 1);
    rt.lastMarkAt = t;
    return;
  }

  // Advantage active: keep marking in sync with called balls so checks happen on schedule.
  rt.markedCalledCount = calledLen;
  rt.lastMarkAt = t;
}

function getRobotVisibleCalledNumbers(session, rt) {
  const len = Math.min(
    session.calledNumbers.length,
    Math.max(0, Number(rt.markedCalledCount) || 0)
  );
  return session.calledNumbers.slice(0, len);
}

function declareRobotWinner(io, session, rt, cartelId, t) {
  const winnerPayload = session.declareWinner(io, {
    socketId: rt.pseudoSocketId,
    cartelId,
    primaryCartelId: cartelId,
    playerName: rt.displayName,
    winners: undefined,
  });

  if (!winnerPayload) return false;

  rt.claimedForRound = true;
  rt.pendingClaim = null;
  rt.lastEventAt = t;

  broadcastAdmin('admin:robotActivity', {
    type: 'robot_bingo_claim',
    robotId: rt.robotId,
    gameId: session.gameId,
    at: new Date().toISOString(),
    cartelId,
    calledCount: session.calledNumbers.length,
  });

  try {
    const { emitGameStatus } = require('./adminService');
    emitGameStatus(session);
  } catch {
    /* admin optional */
  }

  console.info('[robots] Robot bingo — game ended', {
    robotId: rt.robotId,
    gameId: session.gameId,
    cartelId,
    calledCount: session.calledNumbers.length,
  });

  return true;
}

function isHumanUserId(userId) {
  return !String(userId || '').startsWith('robot:');
}

function humanWinLineCellKey(row, col) {
  return `${row}-${col}`;
}

function humanWinLineKeys(cells) {
  return new Set(cells.map(([row, col]) => humanWinLineCellKey(row, col)));
}

/** Read-only mirror of bingoWin.js win lines for 1-step completion scans. */
const HUMAN_WIN_LINES = [
  ...Array.from({ length: 5 }, (_, row) =>
    humanWinLineKeys([0, 1, 2, 3, 4].map((col) => [row, col]))
  ),
  ...Array.from({ length: 5 }, (_, col) =>
    humanWinLineKeys([0, 1, 2, 3, 4].map((row) => [row, col]))
  ),
  humanWinLineKeys([0, 1, 2, 3, 4].map((i) => [i, i])),
  humanWinLineKeys([0, 1, 2, 3, 4].map((i) => [i, 4 - i])),
  humanWinLineKeys([
    [0, 0],
    [0, 4],
    [4, 0],
    [4, 4],
  ]),
];

function getHumanPlayerCartelMarks(player, cartelId) {
  return (
    player?.manualMarks?.[String(cartelId)] ??
    player?.manualMarks?.[cartelId] ??
    []
  );
}

function minHumanRemainingCellsToWin(cartelId, calledNumbers, manualMarks, automatic) {
  const markedKeys = getCartelMarkedKeys(
    cartelId,
    calledNumbers,
    manualMarks,
    automatic
  );
  let minRemaining = Infinity;

  for (const line of HUMAN_WIN_LINES) {
    let remaining = 0;
    for (const key of line) {
      if (!markedKeys.has(key)) remaining += 1;
    }
    minRemaining = Math.min(minRemaining, remaining);
  }

  return minRemaining;
}

/**
 * Human completed bingo on the latest call after being exactly 1 cell from a win.
 */
function isHumanOneStepCompletionOnCurrentCall(session, player, cartelId) {
  const calledNumbers = session.calledNumbers;
  if (!Array.isArray(calledNumbers) || calledNumbers.length < 1) return false;

  const manualMarks = getHumanPlayerCartelMarks(player, cartelId);
  const automatic = Boolean(player.automatic);
  const beforeCall = calledNumbers.slice(0, -1);

  if (!validateBingoClaim(cartelId, calledNumbers, manualMarks, automatic)) {
    return false;
  }
  if (validateBingoClaim(cartelId, beforeCall, manualMarks, automatic)) {
    return false;
  }

  return minHumanRemainingCellsToWin(cartelId, beforeCall, manualMarks, automatic) === 1;
}

function anyHumanOneStepCompletionOnCurrentCall(session) {
  for (const player of session.players.values()) {
    if (!isHumanUserId(player.userId)) continue;
    const cartelIds = player.cartelIds;
    if (!Array.isArray(cartelIds) || cartelIds.length === 0) continue;

    for (const rawId of cartelIds) {
      const cartelId = Number(rawId);
      if (!Number.isInteger(cartelId) || cartelId < 1) continue;
      if (isHumanOneStepCompletionOnCurrentCall(session, player, cartelId)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Emergency override inside win evaluation: when a human just completed bingo on
 * this call (was 1 step away), declare the designated robot winner on this call.
 * Win-percent scheduling (canRobotClaimNow) is not used here; normal path below is unchanged.
 */
function tryEmergencyRobotWinOnHumanOneStepCompletion(
  io,
  session,
  runtime,
  designatedRobotId,
  t
) {
  if (!anyHumanOneStepCompletionOnCurrentCall(session)) return false;
  if (!designatedRobotId) return false;

  for (const rt of runtime.values()) {
    if (!robotIsDesignatedWinner(rt, designatedRobotId, runtime)) continue;
    if (!isParticipatingRobot(session, rt) || rt.claimedForRound) continue;

    syncRobotCartelsForRound(session, rt);
    if (!rt.paidForRound || !rt.currentRoundCartels?.length) continue;

    const plan = robotDrawAssist.getRoundPlan(session.gameId);
    const cartelIds = rt.currentRoundCartels;
    const preferredCartelId =
      plan?.cartelId != null && cartelIds.includes(Number(plan.cartelId))
        ? Number(plan.cartelId)
        : null;
    const orderedCartelIds = preferredCartelId
      ? [preferredCartelId, ...cartelIds.filter((id) => Number(id) !== preferredCartelId)]
      : cartelIds;

    for (const cartelId of orderedCartelIds) {
      if (!validateBingoClaim(cartelId, session.calledNumbers, {}, true)) continue;
      if (declareRobotWinner(io, session, rt, cartelId, t)) {
        return true;
      }
    }
  }

  return false;
}

function countPaidEnabledRobots(runtime) {
  return [...runtime.values()].filter(
    (rt) => rt.paidForRound && rt.enabled !== false
  ).length;
}

function getDesignatedWinnerRobotId(session, runtime, state) {
  if (state?.designatedWinnerRobotId) {
    return String(state.designatedWinnerRobotId);
  }
  const plan = robotDrawAssist.getRoundPlan(session?.gameId);
  if (plan?.robotId) return String(plan.robotId);
  return null;
}

function robotIsDesignatedWinner(rt, designatedRobotId, runtime) {
  if (!designatedRobotId || countPaidEnabledRobots(runtime) <= 1) {
    return true;
  }
  return String(rt.robotId) === String(designatedRobotId);
}

function trySubmitPendingClaims(io, session, runtime, advantageLevel, t, state) {
  const claimDelay = getRobotClaimDelayMs(advantageLevel);
  readSessionWinPercent(session);
  const designatedRobotId = getDesignatedWinnerRobotId(session, runtime, state);

  for (const rt of runtime.values()) {
    if (!robotIsDesignatedWinner(rt, designatedRobotId, runtime)) continue;
    if (!rt.pendingClaim || rt.claimedForRound) continue;
    if (!rt.paidForRound) {
      rt.pendingClaim = null;
      continue;
    }

    const pending = rt.pendingClaim;
    if (t - pending.detectedAt < claimDelay) continue;
    if (!robotDrawAssist.canRobotClaimNow(rt, session.calledNumbers.length, advantageLevel)) {
      continue;
    }

    if (!validateBingoClaim(pending.cartelId, session.calledNumbers, {}, true)) {
      rt.pendingClaim = null;
      continue;
    }

    if (declareRobotWinner(io, session, rt, pending.cartelId, t)) {
      return true;
    }
  }

  return false;
}

function tryEvaluateBingos(io, session, cfg, runtime, state, advantageLevel) {
  if (!session || session.status !== 'calling' || session.resetTimer) return;
  if (session.winner || session._winnerLocked) return;
  if (!hasEnabledRobotsInRound(session, runtime, cfg)) return;

  const calledLen = session.calledNumbers.length;
  if (!calledLen) return;

  const t = now();
  const level = clampRobotAdvantageLevel(advantageLevel);
  const designatedRobotId = getDesignatedWinnerRobotId(session, runtime, state);

  if (
    tryEmergencyRobotWinOnHumanOneStepCompletion(
      io,
      session,
      runtime,
      designatedRobotId,
      t
    )
  ) {
    return;
  }

  if (trySubmitPendingClaims(io, session, runtime, level, t, state)) {
    return;
  }
  if (session.status !== 'calling') return;

  state.lastBingoEvalCalledLen = calledLen;

  for (const rt of runtime.values()) {
    if (!robotIsDesignatedWinner(rt, designatedRobotId, runtime)) continue;
    if (!isParticipatingRobot(session, rt)) continue;
    if (rt.claimedForRound) continue;

    syncRobotCartelsForRound(session, rt);
    if (!rt.paidForRound) continue;
    if (!rt.currentRoundCartels?.length) continue;

    rt.targetWinBallCount = getRobotTargetWinBallCount(level, rt.robotId);
    advanceRobotMarking(rt, session, level, t);

    if (!robotDrawAssist.canRobotClaimNow(rt, calledLen, level)) continue;

    for (const cartelId of rt.currentRoundCartels) {
      if (!validateBingoClaim(cartelId, session.calledNumbers, {}, true)) continue;

      if (declareRobotWinner(io, session, rt, cartelId, t)) {
        return;
      }
    }
  }
}

function markPaidRobotsIfStakesCharged(session, runtime, state, advantageLevel = 0) {
  state.activeRoundCounter += 1;
  const roundId = state.activeRoundCounter;
  state.lastBingoEvalCalledLen = 0;

  for (const rt of runtime.values()) {
    if (!isParticipatingRobot(session, rt)) continue;

    syncRobotCartelsForRound(session, rt);
    resetRobotRoundTiming(rt);

    const seatedCartels = getSeatedRobotCartels(session, rt);

    if (seatedCartels.length >= MIN_CARTELAS_TO_PLAY) {
      rt.currentRoundCartels = seatedCartels;
      rt.paidForRound = true;
      rt.active = true;
      rt.currentRoundId = roundId;
      rt.targetWinBallCount = getRobotTargetWinBallCount(advantageLevel, rt.robotId);
      void robotStatsService
        .markRoundStarted(rt.robotId, { username: rt.username })
        .catch(() => {});
    } else {
      rt.paidForRound = false;
      rt.currentRoundId = roundId;
      rt.targetWinBallCount = null;
    }
  }

  const paidForRotation = [...runtime.values()].filter(
    (rt) => rt.paidForRound && rt.enabled !== false
  );
  const designatedWinner = robotDrawAssist.pickDesignatedWinnerRobot(
    paidForRotation,
    state.lastWinnerRobotId ?? null
  );
  state.designatedWinnerRobotId = designatedWinner?.robotId ?? null;

  robotDrawAssist.createRoundPlan(session, runtime, advantageLevel, {
    designatedRobotId: state.designatedWinnerRobotId,
    lastWinnerRobotId: state.lastWinnerRobotId ?? null,
  });

  if (state.designatedWinnerRobotId && paidForRotation.length > 1) {
    console.info('[robots] Designated winner rotation', {
      gameId: session.gameId,
      roundId,
      designatedWinnerRobotId: state.designatedWinnerRobotId,
      lastWinnerRobotId: state.lastWinnerRobotId ?? null,
      paidRobots: paidForRotation.map((rt) => rt.robotId),
    });
  }

  return roundId;
}

function tryResolveRoundOutcome(io, session, runtime, state, roundId, winnerPseudoSocketId, cfg) {
  if (roundId <= 0) return;
  if (state.lastResolvedRoundId >= roundId) return;

  const outcomeCalledCount = session.calledNumbers.length;
  const prize =
    session._humanPrizesDistributed === true
      ? 0
      : Math.floor(Math.max(0, Number(session.derash) || 0));
  const winnerRt = winnerPseudoSocketId
    ? findRobotByPseudoSocketId(runtime, winnerPseudoSocketId)
    : null;

  for (const rt of runtime.values()) {
    if (!rt.paidForRound) continue;
    if (rt.currentRoundId !== roundId) continue;

    const stakePaid = (rt.currentRoundCartels.length || 0) * session.stake;
    const isWin = Boolean(winnerRt && winnerRt.robotId === rt.robotId);
    if (isWin) {
      const credited = robotBankService.topupSync(prize);
      if (!credited?.ok) {
        console.warn('[robots] bank credit failed:', credited?.error || credited);
      }
    }

    void robotStatsService
      .recordRoundFinished(rt.robotId, {
        outcome: isWin ? 'win' : 'loss',
        stakePaid,
        prizeWon: isWin ? prize : 0,
        gameId: session.gameId,
        cartelIds: rt.currentRoundCartels,
        calledCountAtEnd: outcomeCalledCount,
        username: rt.username,
      })
      .catch((err) => {
        console.warn('[robots] stats save failed:', err?.message || err);
      });

    rt.paidForRound = false;
    rt.claimedForRound = false;
    rt.currentRoundCartels = [];
    rt.active = false;
    rt.currentRoundId = 0;
    rt._joinWhenRemainingSec = null;
    rt._joinCountdownEndsAt = null;
    rt.nextJoinAt = null;
    rt.nextLeaveAt = null;
    resetRobotRoundTiming(rt);
  }

  state.lastResolvedRoundId = roundId;
  if (winnerRt?.robotId) {
    state.lastWinnerRobotId = winnerRt.robotId;
  }
  state.designatedWinnerRobotId = null;
  robotDrawAssist.clearRoundPlan(session.gameId);

  broadcastAdmin('admin:robotActivity', {
    type: 'round_resolved',
    gameId: session.gameId,
    roundId,
    winnerRobotId: winnerRt?.robotId ?? null,
    at: new Date().toISOString(),
    calledCount: outcomeCalledCount,
    prize,
  });
}

function syncAllActiveRobotsIntoSession(session, io, cfg, runtime, options = {}) {
  if (!canRobotsJoinLobby(session)) return 0;
  if (cfg.enabledGlobal !== true) return 0;

  const enabledRobots = [...runtime.values()].filter((rt) => rt.enabled);
  if (!enabledRobots.length) return 0;

  const activeCount = () =>
    [...runtime.values()].filter(
      (x) => x.enabled && session.players.get(x.pseudoSocketId)?.cartelIds?.length
    ).length;

  let joined = 0;
  for (const rt of enabledRobots) {
    if (activeCount() >= cfg.maxActiveRobots) break;

    if (session.players.get(rt.pseudoSocketId)?.cartelIds?.length) {
      rt.active = true;
      syncCartelsFromSession(session, rt);
      trackRobotRoomMember(session, rt);
      continue;
    }

    if (!rt.active) {
      scheduleRobotLobbyJoin(rt, session);
    }

    if (tryJoin(session, io, rt, cfg, runtime, activeCount, options)) {
      joined += 1;
    }
  }

  return joined;
}

function runLobbyTick(session, io, cfg, runtime, state) {
  if (!canRobotsJoinLobby(session)) return;

  for (const rt of runtime.values()) {
    if (!rt.enabled) continue;
    if (session.players.get(rt.pseudoSocketId)?.cartelIds?.length) {
      rt.active = true;
      syncCartelsFromSession(session, rt);
      trackRobotRoomMember(session, rt);
      continue;
    }
    if (!rt.active) {
      scheduleRobotLobbyJoin(rt, session);
    }
  }

  const MAX_OPS_PER_TICK = Math.max(6, Math.floor((cfg.maxActiveRobots || 10) * 2));
  let opsUsed = 0;

  if (cfg.enabledGlobal !== true) {
    for (const rt of runtime.values()) {
      if (!rt.enabled || !rt.active) continue;
      session.removePlayer(rt.pseudoSocketId);
      untrackRobotRoomMember(session, rt);
      rt.active = false;
      rt.currentRoundCartels = [];
      rt.paidForRound = false;
      rt.claimedForRound = false;
      rt.currentRoundId = 0;
      rt._joinWhenRemainingSec = null;
      rt._joinCountdownEndsAt = null;
      rt.nextJoinAt = null;
      rt.nextLeaveAt = null;
    }
    try {
      emitPlayersUpdate(io, session);
      session.emitLobbySelectionUpdate(io);
    } catch {
      /* ignore */
    }
    emitGameStatus(session);
    return;
  }

  for (const rt of runtime.values()) {
    if (opsUsed >= MAX_OPS_PER_TICK) break;
    if (!rt.active) continue;
    const due = !rt.enabled || (rt.nextLeaveAt != null && now() >= rt.nextLeaveAt);
    if (!due) continue;
    tryLeave(session, io, rt, cfg);
    opsUsed += 1;
  }

  const activeCount = () =>
    [...runtime.values()].filter((x) => x.enabled && x.active && x.currentRoundCartels.length > 0)
      .length;

  for (const rt of runtime.values()) {
    if (opsUsed >= MAX_OPS_PER_TICK) break;
    if (!rt.enabled) continue;

    if (rt.active && (!rt.currentRoundCartels || rt.currentRoundCartels.length === 0)) {
      maybeAssignCartelsForActiveButEmpty(session, io, rt, cfg);
      opsUsed += 1;
      continue;
    }

    if (!rt.active && isRobotLobbyJoinDue(session, rt)) {
      if (activeCount() >= cfg.maxActiveRobots) continue;
      tryJoin(session, io, rt, cfg, runtime, activeCount);
      opsUsed += 1;
    }

    if (activeCount() >= cfg.maxActiveRobots) break;
  }

  if (opsUsed >= MAX_OPS_PER_TICK) {
    const t = now();
    if (t - state.lastOpsCapLogAt > 10000) {
      state.lastOpsCapLogAt = t;
      console.warn('[robots] ops cap reached; skipping remaining joins/leaves');
    }
  }
}

module.exports = {
  createRuntimeEntry,
  findRobotByPseudoSocketId,
  syncCartelsFromSession,
  resetRobotRoundTiming,
  tryJoin,
  tryLeave,
  maybeAssignCartelsForActiveButEmpty,
  markPaidRobotsIfStakesCharged,
  tryEvaluateBingos,
  tryResolveRoundOutcome,
  runLobbyTick,
  isSelectionOpen,
  canRobotsJoinLobby,
  syncAllActiveRobotsIntoSession,
  scheduleRobotLobbyJoin,
  isRobotLobbyJoinDue,
  readSessionWinPercent,
  hasEnabledRobotsInRound,
};
