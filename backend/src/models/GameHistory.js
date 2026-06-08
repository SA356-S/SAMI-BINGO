const { mongoose } = require('../config/db');

const gameHistorySchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    gameId: { type: String, required: true, index: true },
    type: {
      type: String,
      enum: ['victory', 'finished', 'played'],
      default: 'finished',
    },
    stake: { type: Number, default: 0 },
    prize: { type: Number, default: 0 },
    cartelId: { type: Number, default: null },
    winnerLabel: { type: String, default: '' },
    finishedAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

const GameHistoryModel =
  mongoose.models.GameHistory ||
  mongoose.model('GameHistory', gameHistorySchema);

module.exports = { GameHistoryModel };
