const { mongoose } = require('../config/db');

const playerStatsSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, unique: true, index: true },
    username: { type: String, default: '' },
    gamesPlayed: { type: Number, default: 0 },
    wins: { type: Number, default: 0 },
    losses: { type: Number, default: 0 },
    dailyGames: { type: Number, default: 0 },
    weeklyGames: { type: Number, default: 0 },
    dailyWins: { type: Number, default: 0 },
    weeklyWins: { type: Number, default: 0 },
    lastDailyKey: { type: String, default: '' },
    lastWeeklyKey: { type: String, default: '' },
  },
  { timestamps: true }
);

const PlayerStatsModel =
  mongoose.models.PlayerStats ||
  mongoose.model('PlayerStats', playerStatsSchema);

module.exports = { PlayerStatsModel };
