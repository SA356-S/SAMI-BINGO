const { gameManager } = require('../socket/gameManager');
const { chargeAndStartSession } = require('../socket/walletManager');
const { WalletTransactionModel } = require('../models/WalletTransaction');
const { mongoose } = require('../config/db');
const robotManagementService = require('./robotManagementService');
const robotConfigService = require('./robotConfigService');
const robotStatsService = require('./robotStatsService');

/** @type {import('socket.io').Server | null} */
let ioRef = null;

function setAdminIo(io) {
  ioRef = io;
}

function mapGameStatus(session) {
  if (!session) return 'STOPPED';
  if (session.status === 'calling') return 'RUNNING';
  if (session.status === 'finished' || session.status === 'ended') {
    return 'FINISHED';
  }
  return 'STOPPED';
}

function sessionSnapshot(session) {
  const players = session.buildPlayersList();
  const activePlayers = players.filter((p) => p.status === 'active');

  const cartelas = [];
  for (const p of players) {
    for (const cartelId of p.cartelIds || []) {
      cartelas.push({
        cartelId,
        userId: p.userId,
        playerName: p.displayName || p.playerName,
        status: p.status,
      });
    }
  }

  return {
    gameId: session.gameId,
    status: mapGameStatus(session),
    rawStatus: session.status,
    lobbyPhase: session.lobbyPhase,
    calledNumbers: [...session.calledNumbers],
    latestBall: session.latestBall ?? null,
    playersCount: session.playersCount,
    activePlayersCount: activePlayers.length,
    derash: session.derash,
    pot: session.derash,
    totalPool: session.grossPool,
    countdownSeconds: session.getLobbyCountdownRemaining?.() ?? 0,
    players,
    cartelas,
    soldCartelasCount: session.takenCartels.size,
  };
}

function resolveSession(gameId) {
  if (gameId) {
    return gameManager.getOrCreateSession(String(gameId));
  }
  const active = [...gameManager.sessions.values()].find(
    (s) => s.status === 'calling'
  );
  return active || gameManager.getLobbySession();
}

function broadcastAdmin(event, payload) {
  if (!ioRef) return;
  ioRef.to('admin').emit(event, payload);
}

function hasAdminIo() {
  return ioRef != null;
}

function getAdminIo() {
  return ioRef;
}

function emitGameStatus(session) {
  const snapshot = sessionSnapshot(session);
  broadcastAdmin('gameStatus', snapshot);
  broadcastAdmin('admin:gameStatus', snapshot);
  return snapshot;
}

function emitNewNumber(session, number) {
  const payload = {
    gameId: session.gameId,
    number,
    calledNumbers: [...session.calledNumbers],
    latestBall: number,
    status: mapGameStatus(session),
  };
  broadcastAdmin('newNumber', payload);
  broadcastAdmin('admin:newNumber', payload);
  return payload;
}

function getDashboardSnapshot() {
  const session = resolveSession();
  return {
    ok: true,
    sessions: gameManager.listSessions(),
    game: sessionSnapshot(session),
    withdrawRequests: { pending: 0, approved: 0, rejected: 0, total: 0 },
  };
}

async function getDashboardSnapshotAsync() {
  const session = resolveSession();
  let withdrawRequests = { pending: 0, approved: 0, rejected: 0, total: 0 };
  let dailyProfit = null;
  try {
    const { getWithdrawRequestStats } = require('./withdrawAdminService');
    withdrawRequests = await getWithdrawRequestStats();
  } catch (err) {
    console.warn('[admin] withdraw stats failed', err?.message || err);
  }
  try {
    const { getDailyProfitSummary } = require('./dailyProfitService');
    dailyProfit = await getDailyProfitSummary();
  } catch (err) {
    console.warn('[admin] daily profit failed', err?.message || err);
  }
  return {
    ok: true,
    sessions: gameManager.listSessions(),
    game: sessionSnapshot(session),
    withdrawRequests,
    dailyProfit,
  };
}

function isRobotUserId(userId) {
  return String(userId || '').startsWith('robot:');
}

function resolveActiveRobotIds() {
  const lobby = gameManager.getLobbySession();
  const set = new Set();
  for (const p of lobby.players.values()) {
    if (p.userId && isRobotUserId(p.userId) && p.cartelIds?.length) {
      set.add(String(p.userId));
    }
  }
  return set;
}

async function getRobotsSnapshot() {
  const profiles = await robotManagementService.listRobots();
  let stats = [];
  try {
    stats = await robotStatsService.listAllRobotStats();
  } catch (err) {
    console.warn('[admin] robot stats load failed:', err?.message || err);
  }
  const byId = new Map((stats || []).map((s) => [String(s.robotId), s]));
  const cfg = await robotConfigService.getConfig();

  const activeRobotIds = resolveActiveRobotIds();
  const disabled = profiles.filter((r) => r.status !== 'on');

  const totalStake = (stats || []).reduce(
    (sum, s) => sum + Number(s.totalStake || 0),
    0
  );
  const totalWins = (stats || []).reduce((sum, s) => sum + Number(s.wins || 0), 0);
  const netPnl = (stats || []).reduce((sum, s) => sum + Number(s.netPnl || 0), 0);
  const gamesPlayed = (stats || []).reduce(
    (sum, s) => sum + Number(s.gamesPlayed || 0),
    0
  );
  const activeGames = (stats || []).reduce(
    (sum, s) => sum + Number(s.activeGames || 0),
    0
  );

  const robots = profiles.map((r) => {
    const s = byId.get(String(r.robotId)) ?? null;
    const seed = String(r.robotId).replace(/\D/g, '').slice(-6) || '0';
    return {
      robotId: String(r.robotId),
      name: r.name,
      displayName: r.name,
      username: '',
      avatarSeed: seed,
      status: r.status,
      enabled: r.status === 'on',
      active: activeRobotIds.has(String(r.robotId)),
      createdAt: r.createdAt,
      stats: s
        ? {
            gamesPlayed: Number(s.gamesPlayed || 0),
            wins: Number(s.wins || 0),
            losses: Number(s.losses || 0),
            totalStake: Number(s.totalStake || 0),
            totalPrizes: Number(s.totalPrizes || 0),
            netPnl: Number(s.netPnl || 0),
            activeGames: Number(s.activeGames || 0),
          }
        : {
            gamesPlayed: 0,
            wins: 0,
            losses: 0,
            totalStake: 0,
            totalPrizes: 0,
            netPnl: 0,
            activeGames: 0,
          },
    };
  });

  return {
    ok: true,
    config: {
      enabledGlobal: cfg.enabledGlobal,
      minCards: cfg.minCards,
      maxCards: cfg.maxCards,
      maxActiveRobots: cfg.maxActiveRobots,
      activityLevel: cfg.activityLevel,
      joinJitterMs: cfg.joinJitterMs,
      leaveJitterMs: cfg.leaveJitterMs,
      bankBalance: Number(cfg.bankBalance || 0),
    },
    summary: {
      totalRobots: robots.length,
      activeRobots: robots.filter((r) => r.active).length,
      disabledRobots: disabled.length,
      totalStake,
      totalWins,
      netPnl,
      gamesPlayed,
      activeGames,
    },
    robots,
  };
}

async function emitRobotsSnapshot() {
  const snapshot = await getRobotsSnapshot();
  broadcastAdmin('admin:robots', snapshot);
  return snapshot;
}

async function listRecentPayments(limit = 50) {
  if (mongoose.connection?.readyState !== 1) {
    return { deposits: [], withdraws: [] };
  }

  const rows = await WalletTransactionModel.find()
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  const deposits = [];
  const withdraws = [];

  for (const row of rows) {
    const item = {
      id: String(row._id),
      userId: row.userId,
      amount: Number(row.amount) || 0,
      reference: row.reference || '',
      channel: row.channel || 'TELE',
      detail: row.detail || '',
      status: 'completed',
      createdAt: row.createdAt,
    };
    if (row.type === 'withdraw') withdraws.push(item);
    else deposits.push(item);
  }

  return { deposits, withdraws };
}

function startGame(gameId, { forceStart = true } = {}) {
  const io = ioRef;
  if (!io) return { ok: false, error: 'Socket server not ready' };

  const session = resolveSession(gameId);
  const result = chargeAndStartSession(session, io, { forceStart });

  if (!result.ok) {
    return result;
  }

  session.emitPerPlayer(io, 'game:started');
  const snapshot = emitGameStatus(session);
  return { ok: true, ...result, game: snapshot };
}

function stopGame(gameId) {
  const io = ioRef;
  if (!io) return { ok: false, error: 'Socket server not ready' };

  const session = resolveSession(gameId);
  session.stopCalling();
  io.to(session.roomName).emit('game:finished', session.toBallPayload());
  const snapshot = emitGameStatus(session);
  return { ok: true, game: snapshot };
}

function drawNumber(gameId) {
  const io = ioRef;
  if (!io) return { ok: false, error: 'Socket server not ready' };

  const session = resolveSession(gameId);
  if (session.status !== 'calling') {
    return { ok: false, error: 'Game is not running' };
  }

  const before = session.calledNumbers.length;
  session.callNextBall(io);
  const after = session.calledNumbers.length;

  if (after <= before) {
    return { ok: false, error: 'No more numbers to draw' };
  }

  const number = session.latestBall;
  emitNewNumber(session, number);
  emitGameStatus(session);
  return { ok: true, number, game: sessionSnapshot(session) };
}

function resetGame(gameId) {
  const io = ioRef;
  if (!io) return { ok: false, error: 'Socket server not ready' };

  const session = resolveSession(gameId);
  session.resetForNewRound();

  const resetPayload = session.toResetPayload();
  io.to(session.roomName).emit('game:reset', resetPayload);
  io.to(session.roomName).emit('game:redirect', resetPayload);
  io.emit('game:lobby-tick', session.toLobbySyncPayload());

  const snapshot = emitGameStatus(session);
  return { ok: true, game: snapshot };
}

module.exports = {
  setAdminIo,
  mapGameStatus,
  sessionSnapshot,
  resolveSession,
  broadcastAdmin,
  hasAdminIo,
  getAdminIo,
  emitGameStatus,
  emitNewNumber,
  getRobotsSnapshot,
  emitRobotsSnapshot,
  getDashboardSnapshot,
  getDashboardSnapshotAsync,
  listRecentPayments,
  startGame,
  stopGame,
  drawNumber,
  resetGame,
};
