const { mongoose } = require('../config/db');
const { RobotStatsModel } = require('../models/RobotStats');

const memoryStats = new Map(); // robotId -> stats doc
const MAX_RECENT = 50;

function isDbReady() {
  return mongoose.connection?.readyState === 1;
}

function defaultStats(robotId, username = '') {
  return {
    robotId: String(robotId),
    username: String(username || ''),
    gamesPlayed: 0,
    wins: 0,
    losses: 0,
    totalStake: 0,
    totalPrizes: 0,
    netPnl: 0,
    activeGames: 0,
    lastActiveAt: null,
    recentRounds: [],
  };
}

async function loadRobotStats(robotId, { username = '' } = {}) {
  const id = String(robotId);
  if (isDbReady()) {
    const doc = await RobotStatsModel.findOneAndUpdate(
      { robotId: id },
      { $setOnInsert: defaultStats(id, username) },
      { upsert: true, new: true, lean: true }
    );
    return doc;
  }

  if (!memoryStats.has(id)) {
    memoryStats.set(id, defaultStats(id, username));
  } else if (username && memoryStats.get(id).username !== username) {
    const current = memoryStats.get(id);
    memoryStats.set(id, { ...current, username });
  }

  return memoryStats.get(id);
}

async function saveRobotStats(stats) {
  const id = String(stats.robotId);
  if (isDbReady()) {
    await RobotStatsModel.findOneAndUpdate(
      { robotId: id },
      { $set: stats },
      { upsert: true, new: true }
    );
  } else {
    memoryStats.set(id, { ...stats });
  }
}

async function markRoundStarted(robotId, { username = '' } = {}) {
  const stats = await loadRobotStats(robotId, { username });
  stats.activeGames = Number(stats.activeGames || 0) + 1;
  stats.lastActiveAt = new Date();
  await saveRobotStats(stats);
  return stats;
}

async function recordRoundFinished(robotId, {
  outcome = 'loss',
  stakePaid = 0,
  prizeWon = 0,
  gameId = '',
  cartelIds = [],
  calledCountAtEnd = 0,
  username = '',
} = {}) {
  const stats = await loadRobotStats(robotId, { username });
  const stake = Number(stakePaid) || 0;
  const prize = Number(prizeWon) || 0;

  stats.gamesPlayed = Number(stats.gamesPlayed || 0) + 1;
  if (outcome === 'win') stats.wins = Number(stats.wins || 0) + 1;
  else stats.losses = Number(stats.losses || 0) + 1;

  stats.totalStake = Number(stats.totalStake || 0) + stake;
  stats.totalPrizes = Number(stats.totalPrizes || 0) + prize;
  stats.netPnl = Number(stats.netPnl || 0) + (prize - stake);

  stats.activeGames = Math.max(0, Number(stats.activeGames || 0) - 1);
  stats.lastActiveAt = new Date();

  stats.recentRounds = Array.isArray(stats.recentRounds) ? stats.recentRounds : [];
  stats.recentRounds.unshift({
    gameId: String(gameId || ''),
    cartelIds: Array.isArray(cartelIds) ? cartelIds.map(Number) : [],
    stakePaid: stake,
    prizeWon: prize,
    outcome: outcome === 'win' ? 'win' : 'loss',
    calledCountAtEnd: Number(calledCountAtEnd) || 0,
  });
  if (stats.recentRounds.length > MAX_RECENT) {
    stats.recentRounds.length = MAX_RECENT;
  }

  await saveRobotStats(stats);
  return stats;
}

async function getRobotStats(robotId) {
  return loadRobotStats(robotId);
}

async function listAllRobotStats() {
  if (isDbReady()) {
    const docs = await RobotStatsModel.find({}).lean();
    return docs;
  }

  return [...memoryStats.values()];
}

module.exports = {
  markRoundStarted,
  recordRoundFinished,
  getRobotStats,
  listAllRobotStats,
};

