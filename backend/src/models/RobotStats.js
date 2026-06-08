const { mongoose } = require('../config/db');

const recentRoundSchema = new mongoose.Schema(
  {
    gameId: { type: String, default: '' },
    cartelIds: { type: [Number], default: [] },
    stakePaid: { type: Number, default: 0 },
    prizeWon: { type: Number, default: 0 },
    outcome: { type: String, default: 'loss' }, // win|loss|timeout
    calledCountAtEnd: { type: Number, default: 0 },
  },
  { _id: false }
);

const robotStatsSchema = new mongoose.Schema(
  {
    robotId: { type: String, required: true, unique: true, index: true },
    username: { type: String, default: '' },

    gamesPlayed: { type: Number, default: 0 },
    wins: { type: Number, default: 0 },
    losses: { type: Number, default: 0 },

    totalStake: { type: Number, default: 0 },
    totalPrizes: { type: Number, default: 0 },
    netPnl: { type: Number, default: 0 },

    activeGames: { type: Number, default: 0 },
    lastActiveAt: { type: Date, default: null },

    recentRounds: { type: [recentRoundSchema], default: [] },
  },
  { timestamps: true }
);

const RobotStatsModel =
  mongoose.models.RobotStats || mongoose.model('RobotStats', robotStatsSchema);

module.exports = { RobotStatsModel };

