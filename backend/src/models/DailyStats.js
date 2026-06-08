const { mongoose } = require('../config/db');

const dailyStatsSchema = new mongoose.Schema(
  {
    date: { type: String, required: true, unique: true, index: true },
    totalGamesPlayed: { type: Number, default: 0 },
    gamesCount: { type: Number, default: 0 },
    totalBets: { type: Number, default: 0 },
    totalRevenue: { type: Number, default: 0 },
    totalPayouts: { type: Number, default: 0 },
    houseProfit: { type: Number, default: 0 },
    netProfit: { type: Number, default: 0 },
  },
  { timestamps: true, collection: 'daily_stats' }
);

const DailyStatsModel =
  mongoose.models.DailyStats ||
  mongoose.model('DailyStats', dailyStatsSchema);

module.exports = { DailyStatsModel };
