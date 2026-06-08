const { mongoose } = require('../config/db');
const { gameManager } = require('../socket/gameManager');
const { getWalletBalance } = require('../socket/walletManager');
const { PlayerStatsModel } = require('../models/PlayerStats');
const { GameHistoryModel } = require('../models/GameHistory');
const {
  pickDisplayName,
  resolveDisplayNamesForUserIds,
} = require('./playerDisplayNameService');

/** @type {Map<string, object>} */
const memoryStats = new Map();
/** @type {object[]} */
const memoryHistory = [];
/** @type {object[]} */
const recentWinners = [];
const MAX_HISTORY = 200;
const MAX_RECENT_WINNERS = 20;

function isDbReady() {
  return mongoose.connection?.readyState === 1;
}

function getDailyKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function getWeeklyKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function formatUsername(userId) {
  const id = String(userId || 'player');
  return id.startsWith('@') ? id : `@${id.toUpperCase()}`;
}

function defaultStats(userId) {
  return {
    userId: String(userId),
    username: formatUsername(userId),
    gamesPlayed: 0,
    wins: 0,
    losses: 0,
    dailyGames: 0,
    weeklyGames: 0,
    dailyWins: 0,
    weeklyWins: 0,
    lastDailyKey: getDailyKey(),
    lastWeeklyKey: getWeeklyKey(),
  };
}

function ensurePeriod(stats) {
  const dk = getDailyKey();
  const wk = getWeeklyKey();
  if (stats.lastDailyKey !== dk) {
    stats.dailyGames = 0;
    stats.dailyWins = 0;
    stats.lastDailyKey = dk;
  }
  if (stats.lastWeeklyKey !== wk) {
    stats.weeklyGames = 0;
    stats.weeklyWins = 0;
    stats.lastWeeklyKey = wk;
  }
  return stats;
}

async function loadStats(userId) {
  const key = String(userId);
  if (isDbReady()) {
    const doc = await PlayerStatsModel.findOneAndUpdate(
      { userId: key },
      { $setOnInsert: defaultStats(key) },
      { upsert: true, new: true, lean: true }
    );
    return ensurePeriod({ ...doc });
  }

  if (!memoryStats.has(key)) {
    memoryStats.set(key, defaultStats(key));
  }
  return ensurePeriod({ ...memoryStats.get(key) });
}

async function saveStats(stats) {
  const key = String(stats.userId);
  if (isDbReady()) {
    await PlayerStatsModel.findOneAndUpdate(
      { userId: key },
      { $set: stats },
      { upsert: true, new: true }
    );
  } else {
    memoryStats.set(key, { ...stats });
  }
}

async function appendHistory(entry) {
  const row = {
    ...entry,
    finishedAt: entry.finishedAt ?? new Date(),
  };

  if (isDbReady()) {
    await GameHistoryModel.create(row);
  } else {
    memoryHistory.unshift(row);
    if (memoryHistory.length > MAX_HISTORY) memoryHistory.length = MAX_HISTORY;
  }
}

function pushRecentWinner(entry) {
  recentWinners.unshift(entry);
  if (recentWinners.length > MAX_RECENT_WINNERS) {
    recentWinners.length = MAX_RECENT_WINNERS;
  }
}

async function recordGamePlayed(userId, { gameId, stake = 10 } = {}) {
  if (!userId) return null;
  const stats = await loadStats(userId);
  stats.gamesPlayed += 1;
  stats.dailyGames += 1;
  stats.weeklyGames += 1;
  await saveStats(stats);
  await appendHistory({
    userId: String(userId),
    gameId: String(gameId),
    type: 'played',
    stake: Number(stake) || 0,
    prize: 0,
  });
  return stats;
}

async function recordWin(userId, { gameId, stake = 10, prize = 0, cartelId, winnerLabel } = {}) {
  if (!userId) return null;
  const stats = await loadStats(userId);
  stats.wins += 1;
  stats.dailyWins += 1;
  stats.weeklyWins += 1;
  await saveStats(stats);
  await appendHistory({
    userId: String(userId),
    gameId: String(gameId),
    type: 'victory',
    stake: Number(stake) || 0,
    prize: Number(prize) || 0,
    cartelId: cartelId ?? null,
    winnerLabel: winnerLabel ?? '',
  });
  pushRecentWinner({
    userId: String(userId),
    username: formatUsername(userId),
    gameId: String(gameId),
    prize: Number(prize) || 0,
    cartelId: cartelId ?? null,
    winnerLabel: winnerLabel ?? formatUsername(userId),
    at: new Date().toISOString(),
  });

  try {
    const { addEarnings } = require('./profileService');
    await addEarnings(userId, prize);
  } catch {
    /* profile optional */
  }

  return stats;
}

async function recordLoss(userId, { gameId, stake = 10 } = {}) {
  if (!userId) return null;
  const stats = await loadStats(userId);
  stats.losses += 1;
  await saveStats(stats);
  await appendHistory({
    userId: String(userId),
    gameId: String(gameId),
    type: 'finished',
    stake: Number(stake) || 0,
    prize: 0,
  });
  return stats;
}

async function recordRoundOutcome(session, winnerInfo = {}) {
  const players = session.allSeatedPlayers();
  const humanWinnerIds = new Set(
    (Array.isArray(winnerInfo.humanWinnerIds)
      ? winnerInfo.humanWinnerIds
      : []
    ).map(String)
  );
  const humanWinnerCount = Math.max(
    0,
    Number(winnerInfo.humanWinnerCount) || humanWinnerIds.size
  );
  const prizePool = Math.floor(Math.max(0, Number(session.derash) || 0));
  const { computePrizeSharePerWinner } = require('./prizeDistributionService');
  const prizeSharePerWinner =
    humanWinnerCount <= 1
      ? prizePool
      : Math.floor(
          Number(winnerInfo.prizeSharePerWinner) ||
            computePrizeSharePerWinner(prizePool, humanWinnerCount)
        );

  const winnerUserId = winnerInfo.userId
    ? String(winnerInfo.userId)
    : null;
  const winnerSocketId = winnerInfo.socketId
    ? String(winnerInfo.socketId)
    : null;

  if (humanWinnerIds.size === 0 && (winnerUserId || winnerSocketId)) {
    const fallbackId = winnerUserId || winnerSocketId;
    if (fallbackId) humanWinnerIds.add(fallbackId);
  }

  for (const player of players) {
    const uid = player.userId ? String(player.userId) : String(player.socketId);
    const isWinner =
      humanWinnerIds.has(uid) ||
      (winnerUserId && uid === winnerUserId) ||
      (winnerSocketId && String(player.socketId) === winnerSocketId);

    if (isWinner) {
      await recordWin(uid, {
        gameId: session.gameId,
        stake: session.stake,
        prize: humanWinnerCount > 1 ? prizeSharePerWinner : prizePool,
        cartelId: winnerInfo.primaryCartelId ?? winnerInfo.cartelId,
        winnerLabel: winnerInfo.winnerLabel,
      });
    } else {
      await recordLoss(uid, { gameId: session.gameId, stake: session.stake });
    }
  }
}

async function recordSessionStart(session) {
  const charged = new Set();
  for (const player of session.players.values()) {
    if (!player.cartelIds?.length) continue;
    const uid = player.userId ? String(player.userId) : String(player.socketId);
    if (charged.has(uid)) continue;
    charged.add(uid);
    await recordGamePlayed(uid, { gameId: session.gameId, stake: session.stake });
  }
  for (const player of session.awayPlayers.values()) {
    if (!player.cartelIds?.length) continue;
    const uid = String(player.userId);
    if (charged.has(uid)) continue;
    charged.add(uid);
    await recordGamePlayed(uid, { gameId: session.gameId, stake: session.stake });
  }
}

async function getAllStats() {
  if (isDbReady()) {
    const docs = await PlayerStatsModel.find({}).lean();
    return docs.map((d) => ensurePeriod({ ...d }));
  }
  return [...memoryStats.values()].map((s) => ensurePeriod({ ...s }));
}

async function getLeaderboard(period = 'daily', userId = null) {
  const all = await getAllStats();
  const sortField = period === 'weekly' ? 'weeklyGames' : 'dailyGames';
  const sorted = [...all]
    .filter((s) => s[sortField] > 0)
    .sort((a, b) => b[sortField] - a[sortField]);

  const top10Slice = sorted.slice(0, 10);
  const idsToResolve = top10Slice.map((s) => s.userId);
  if (userId) idsToResolve.push(String(userId));
  const resolvedNames = await resolveDisplayNamesForUserIds(idsToResolve);

  const top10 = top10Slice.map((s, index) => ({
    rank: index + 1,
    username: pickDisplayName(s.userId, s.username, resolvedNames),
    userId: s.userId,
    games: s[sortField],
    wins: period === 'weekly' ? s.weeklyWins : s.dailyWins,
  }));

  let myStats = null;
  let myRank = null;

  if (userId) {
    myStats = await loadStats(userId);
    const idx = sorted.findIndex((s) => String(s.userId) === String(userId));
    myRank = idx >= 0 ? idx + 1 : sorted.length + 1;
  }

  return {
    period,
    top10,
    myStats: myStats
      ? {
          username: pickDisplayName(
            myStats.userId,
            myStats.username,
            resolvedNames
          ),
          rank: myRank,
          gamesPlayed: period === 'weekly' ? myStats.weeklyGames : myStats.dailyGames,
          wins: period === 'weekly' ? myStats.weeklyWins : myStats.dailyWins,
          totalGamesPlayed: myStats.gamesPlayed,
          totalWins: myStats.wins,
          totalLosses: myStats.losses,
        }
      : null,
    totalPlayers: all.length,
  };
}

function getLobbySnapshot(io) {
  const lobby = gameManager.getLobbySession();
  let onlinePlayers = 0;
  let playersInActiveGames = 0;
  let activeCallingGameId = null;
  let jackpot = lobby.derash;

  if (io) {
    onlinePlayers = io.sockets.sockets.size;
  }

  for (const session of gameManager.sessions.values()) {
    if (session.status === 'calling') {
      activeCallingGameId = session.gameId;
      jackpot = session.derash;
      playersInActiveGames += session.buildPlayersList().length;
    }
  }

  return {
    onlinePlayers,
    playersInActiveGames,
    lobbyGameId: lobby.gameId,
    activeGameId: activeCallingGameId,
    roundStatus: activeCallingGameId ? 'calling' : lobby.status,
    jackpot,
    pot: jackpot,
  };
}

function getActiveGameForUser(userId) {
  const session = gameManager.findRejoinableSession(userId);
  if (!session) {
    return {
      hasActiveGame: false,
      canRejoin: false,
      status: 'none',
    };
  }

  return {
    hasActiveGame: true,
    canRejoin: session.canUserRejoin(userId),
    gameId: session.gameId,
    status: session.status,
    calledCount: session.calledNumbers.length,
    playersCount: session.buildPlayersList().length,
    jackpot: session.derash,
  };
}

async function getHomeDashboard(userId, io) {
  const wallet = getWalletBalance(userId);
  const player = await loadStats(userId);
  const activeGame = getActiveGameForUser(userId);
  const lobby = getLobbySnapshot(io);

  const winRate =
    player.gamesPlayed > 0
      ? Math.round((player.wins / player.gamesPlayed) * 100)
      : 0;

  let dbRecentWinners = [];
  if (isDbReady()) {
    const rows = await GameHistoryModel.find({ type: 'victory' })
      .sort({ finishedAt: -1 })
      .limit(10)
      .lean();
    dbRecentWinners = rows.map((r) => ({
      userId: r.userId,
      username: formatUsername(r.userId),
      gameId: r.gameId,
      prize: r.prize,
      cartelId: r.cartelId,
      at: r.finishedAt,
    }));
  }

  const winners =
    dbRecentWinners.length > 0 ? dbRecentWinners : [...recentWinners].slice(0, 10);

  return {
    ok: true,
    userId: String(userId),
    wallet,
    player: {
      username: player.username || formatUsername(userId),
      gamesPlayed: player.gamesPlayed,
      wins: player.wins,
      losses: player.losses,
      winRate,
      dailyGames: player.dailyGames,
      weeklyGames: player.weeklyGames,
    },
    activeGame,
    lobby,
    recentWinners: winners,
  };
}

async function getScoreDashboard(userId, period = 'daily') {
  const leaderboard = await getLeaderboard(period, userId);
  const lobby = getLobbySnapshot(null);
  return {
    ok: true,
    period,
    ...leaderboard,
    onlinePlayers: lobby.onlinePlayers,
    activeGameId: lobby.activeGameId,
    jackpot: lobby.jackpot,
  };
}

async function getHistory(userId, limit = 50) {
  if (isDbReady()) {
    const rows = await GameHistoryModel.find({ userId: String(userId) })
      .sort({ finishedAt: -1 })
      .limit(limit)
      .lean();
    return rows.map((r) => ({
      id: String(r._id),
      type: r.type === 'victory' ? 'victory' : 'finished',
      gameId: r.gameId.startsWith('#') ? r.gameId : `#${r.gameId}`,
      stake: r.stake,
      prize: r.prize,
      date: new Date(r.finishedAt).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }),
      time: new Date(r.finishedAt).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }),
      amount: r.type === 'victory' ? r.prize : 0,
    }));
  }

  return memoryHistory
    .filter((r) => String(r.userId) === String(userId))
    .slice(0, limit)
    .map((r, i) => ({
      id: String(i),
      type: r.type === 'victory' ? 'victory' : 'finished',
      gameId: r.gameId.startsWith('#') ? r.gameId : `#${r.gameId}`,
      stake: r.stake,
      prize: r.prize,
      date: new Date(r.finishedAt).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }),
      time: new Date(r.finishedAt).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }),
      amount: r.type === 'victory' ? r.prize : 0,
    }));
}

module.exports = {
  recordGamePlayed,
  recordWin,
  recordLoss,
  recordRoundOutcome,
  recordSessionStart,
  getHomeDashboard,
  getScoreDashboard,
  getLeaderboard,
  getHistory,
  formatUsername,
  loadStats,
};
