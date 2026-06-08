const { mongoose } = require('../config/db');
const { DailyStatsModel } = require('../models/DailyStats');
const { HOUSE_COMMISSION_RATE } = require('../config/constants');
const { broadcastAdmin } = require('./adminService');

/** @type {Map<string, object>} */
const memoryDaily = new Map();

function isDbReady() {
  return mongoose.connection?.readyState === 1;
}

/** Server-local calendar day (YYYY-MM-DD). Resets at local midnight. */
function getLocalDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function shiftDateKey(dateKey, days) {
  const [y, m, d] = String(dateKey).split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return getLocalDateKey(dt);
}

function emptyDayRow(date) {
  return {
    date,
    totalGamesPlayed: 0,
    gamesCount: 0,
    totalBets: 0,
    totalRevenue: 0,
    totalPayouts: 0,
    houseProfit: 0,
    netProfit: 0,
  };
}

function normalizeDayRow(doc, date) {
  const row = doc?.toObject ? doc.toObject() : doc;
  if (!row) return emptyDayRow(date);

  return {
    date: row.date || date,
    totalGamesPlayed: Number(row.totalGamesPlayed ?? row.gamesCount) || 0,
    gamesCount: Number(row.gamesCount ?? row.totalGamesPlayed) || 0,
    totalBets: Number(row.totalBets ?? row.totalRevenue) || 0,
    totalRevenue: Number(row.totalRevenue ?? row.totalBets) || 0,
    totalPayouts: Number(row.totalPayouts) || 0,
    houseProfit: Number(row.houseProfit) || 0,
    netProfit: Number(row.netProfit ?? row.houseProfit) || 0,
  };
}

function extractGameFinancials(session, totalPayouts = 0) {
  const totalBets = Math.floor(
    Math.max(0, Number(session.grossPool) || Number(session.totalPool) || 0)
  );
  const houseProfit = session.stakesCharged
    ? Math.floor(Math.max(0, Number(session.houseShare) || 0))
    : Math.floor(totalBets * HOUSE_COMMISSION_RATE);
  const payouts = Math.floor(Math.max(0, Number(totalPayouts) || 0));

  return {
    totalBets,
    totalRevenue: totalBets,
    houseProfit,
    netProfit: houseProfit,
    totalPayouts: payouts,
  };
}

async function upsertDailyRecord(dateKey, delta) {
  const gamesDelta = Number(delta.gamesCount) || 0;
  const betsDelta = Number(delta.totalBets) || 0;
  const payoutsDelta = Number(delta.totalPayouts) || 0;
  const houseDelta = Number(delta.houseProfit) || 0;

  if (isDbReady()) {
    const updated = await DailyStatsModel.findOneAndUpdate(
      { date: dateKey },
      {
        $inc: {
          totalGamesPlayed: gamesDelta,
          gamesCount: gamesDelta,
          totalBets: betsDelta,
          totalRevenue: betsDelta,
          totalPayouts: payoutsDelta,
          houseProfit: houseDelta,
          netProfit: houseDelta,
        },
        $setOnInsert: { date: dateKey },
      },
      { upsert: true, new: true, lean: true }
    );
    return normalizeDayRow(updated, dateKey);
  }

  const prev = memoryDaily.get(dateKey) || emptyDayRow(dateKey);
  const next = {
    ...prev,
    totalGamesPlayed: prev.totalGamesPlayed + gamesDelta,
    gamesCount: prev.gamesCount + gamesDelta,
    totalBets: prev.totalBets + betsDelta,
    totalRevenue: prev.totalRevenue + betsDelta,
    totalPayouts: prev.totalPayouts + payoutsDelta,
    houseProfit: prev.houseProfit + houseDelta,
    netProfit: prev.netProfit + houseDelta,
  };
  memoryDaily.set(dateKey, next);
  return next;
}

async function getDayStats(dateKey) {
  if (isDbReady()) {
    const doc = await DailyStatsModel.findOne({ date: dateKey }).lean();
    return normalizeDayRow(doc, dateKey);
  }
  return normalizeDayRow(memoryDaily.get(dateKey), dateKey);
}

async function getDailyProfitSummary() {
  const todayKey = getLocalDateKey();
  const yesterdayKey = shiftDateKey(todayKey, -1);
  const weekKeys = [];
  for (let i = 0; i < 7; i += 1) {
    weekKeys.push(shiftDateKey(todayKey, -i));
  }

  const [today, yesterday, ...weekDays] = await Promise.all([
    getDayStats(todayKey),
    getDayStats(yesterdayKey),
    ...weekKeys.map((key) => getDayStats(key)),
  ]);

  const weekly = weekDays.reduce(
    (acc, day) => ({
      totalGamesPlayed: acc.totalGamesPlayed + day.totalGamesPlayed,
      gamesCount: acc.gamesCount + day.gamesCount,
      totalBets: acc.totalBets + day.totalBets,
      totalRevenue: acc.totalRevenue + day.totalRevenue,
      totalPayouts: acc.totalPayouts + day.totalPayouts,
      houseProfit: acc.houseProfit + day.houseProfit,
      netProfit: acc.netProfit + day.netProfit,
    }),
    emptyDayRow('weekly')
  );

  return {
    ok: true,
    today,
    yesterday,
    weekly: {
      ...weekly,
      from: weekKeys[weekKeys.length - 1],
      to: todayKey,
      days: weekDays,
    },
  };
}

async function broadcastDailyProfitUpdate() {
  try {
    const summary = await getDailyProfitSummary();
    broadcastAdmin('admin:dailyProfit', summary);
    return summary;
  } catch (err) {
    console.warn('[daily-profit] broadcast failed', err?.message || err);
    return null;
  }
}

/**
 * Record house profit for a completed game (analytics only — no wallet changes).
 * @param {import('../socket/gameManager').GameSession} session
 * @param {{ totalPayouts?: number }} [options]
 */
async function recordCompletedGameProfit(session, options = {}) {
  if (!session?.stakesCharged) {
    return { ok: false, skipped: 'stakes_not_charged' };
  }
  if (session._dailyProfitRecorded) {
    return { ok: false, skipped: 'already_recorded' };
  }

  const financials = extractGameFinancials(session, options.totalPayouts);
  if (financials.totalBets <= 0) {
    return { ok: false, skipped: 'no_revenue' };
  }

  session._dailyProfitRecorded = true;
  const dateKey = getLocalDateKey();
  const day = await upsertDailyRecord(dateKey, {
    gamesCount: 1,
    totalBets: financials.totalBets,
    totalPayouts: financials.totalPayouts,
    houseProfit: financials.houseProfit,
  });

  console.log(
    `[daily-profit] game=${session.gameId} date=${dateKey} bets=${financials.totalBets} payouts=${financials.totalPayouts} house=${financials.houseProfit}`
  );

  await broadcastDailyProfitUpdate();

  return {
    ok: true,
    gameId: session.gameId,
    date: dateKey,
    day,
    ...financials,
  };
}

module.exports = {
  getLocalDateKey,
  getDailyProfitSummary,
  recordCompletedGameProfit,
  broadcastDailyProfitUpdate,
  extractGameFinancials,
};
