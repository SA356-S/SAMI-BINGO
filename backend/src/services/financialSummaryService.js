const { mongoose } = require('../config/db');
const { DepositModel } = require('../models/Deposit');
const { WithdrawRequestModel } = require('../models/WithdrawRequest');
const { broadcastAdmin } = require('./adminService');

const PERIOD_KEYS = ['last24h', 'today', 'last7days', 'thisMonth', 'lifetime'];

function isDbReady() {
  return mongoose.connection?.readyState === 1;
}

function startOfLocalDay(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfLocalMonth(date = new Date()) {
  const d = new Date(date);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getPeriodStartDates(now = new Date()) {
  return {
    last24h: new Date(now.getTime() - 24 * 60 * 60 * 1000),
    today: startOfLocalDay(now),
    last7days: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
    thisMonth: startOfLocalMonth(now),
    lifetime: null,
  };
}

function emptyPeriodRow() {
  return {
    depositTotal: 0,
    depositCount: 0,
    withdrawalTotal: 0,
    withdrawalCount: 0,
    netRevenue: 0,
  };
}

function normalizeGroupRows(rows = []) {
  const row = rows?.[0];
  const total = Math.floor(Math.max(0, Number(row?.total) || 0));
  const count = Math.floor(Math.max(0, Number(row?.count) || 0));
  return { total, count };
}

function buildPeriodRow(depositAgg, withdrawalAgg) {
  const depositTotal = depositAgg.total;
  const withdrawalTotal = withdrawalAgg.total;
  return {
    depositTotal,
    depositCount: depositAgg.count,
    withdrawalTotal,
    withdrawalCount: withdrawalAgg.count,
    netRevenue: depositTotal - withdrawalTotal,
  };
}

function buildDepositFacetStages(starts) {
  const branches = {};
  for (const key of PERIOD_KEYS) {
    const start = starts[key];
    const pipeline =
      start == null
        ? []
        : [{ $match: { eventAt: { $gte: start } } }];
    branches[key] = [
      ...pipeline,
      {
        $group: {
          _id: null,
          total: {
            $sum: {
              $ifNull: ['$verifiedAmount', { $ifNull: ['$amount', 0] }],
            },
          },
          count: { $sum: 1 },
        },
      },
    ];
  }
  return branches;
}

function buildWithdrawFacetStages(starts) {
  const branches = {};
  for (const key of PERIOD_KEYS) {
    const start = starts[key];
    const pipeline =
      start == null ? [] : [{ $match: { updatedAt: { $gte: start } } }];
    branches[key] = [
      ...pipeline,
      {
        $group: {
          _id: null,
          total: { $sum: { $ifNull: ['$amount', 0] } },
          count: { $sum: 1 },
        },
      },
    ];
  }
  return branches;
}

async function aggregateDepositsByPeriod(starts) {
  const [result] = await DepositModel.aggregate([
    { $match: { status: 'approved' } },
    {
      $addFields: {
        eventAt: {
          $ifNull: ['$verifiedAt', { $ifNull: ['$updatedAt', '$createdAt'] }],
        },
      },
    },
    { $facet: buildDepositFacetStages(starts) },
  ]).allowDiskUse(true);

  const out = {};
  for (const key of PERIOD_KEYS) {
    out[key] = normalizeGroupRows(result?.[key]);
  }
  return out;
}

async function aggregateWithdrawalsByPeriod(starts) {
  const [result] = await WithdrawRequestModel.aggregate([
    { $match: { status: 'approved' } },
    { $facet: buildWithdrawFacetStages(starts) },
  ]).allowDiskUse(true);

  const out = {};
  for (const key of PERIOD_KEYS) {
    out[key] = normalizeGroupRows(result?.[key]);
  }
  return out;
}

async function getFinancialSummary() {
  const generatedAt = new Date().toISOString();
  const starts = getPeriodStartDates();

  if (!isDbReady()) {
    const periods = {};
    for (const key of PERIOD_KEYS) {
      periods[key] = emptyPeriodRow();
    }
    return {
      ok: true,
      generatedAt,
      currency: 'ETB',
      periods,
    };
  }

  const [deposits, withdrawals] = await Promise.all([
    aggregateDepositsByPeriod(starts),
    aggregateWithdrawalsByPeriod(starts),
  ]);

  const periods = {};
  for (const key of PERIOD_KEYS) {
    periods[key] = buildPeriodRow(deposits[key], withdrawals[key]);
  }

  return {
    ok: true,
    generatedAt,
    currency: 'ETB',
    periods,
  };
}

async function broadcastFinancialSummaryUpdate() {
  try {
    const summary = await getFinancialSummary();
    broadcastAdmin('admin:financialSummary', summary);
    return summary;
  } catch (err) {
    console.warn('[financial-summary] broadcast failed', err?.message || err);
    return null;
  }
}

module.exports = {
  PERIOD_KEYS,
  getFinancialSummary,
  broadcastFinancialSummaryUpdate,
};
