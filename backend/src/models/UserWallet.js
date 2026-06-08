const { mongoose } = require('../config/db');

/**
 * Persistent wallet balances per user (userId = Telegram ID string).
 * mainWallet — winnings / withdrawable
 * playWallet — deposits / play money
 */
const userWalletSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, unique: true, index: true },
    telegramId: { type: Number, index: true },
    username: { type: String, default: '' },
    phone: { type: String, default: '' },
    mainWallet: { type: Number, default: 0, min: 0 },
    playWallet: { type: Number, default: 0, min: 0 },
    totalDeposits: { type: Number, default: 0, min: 0 },
    totalWithdrawals: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

const UserWalletModel =
  mongoose.models.UserWallet || mongoose.model('UserWallet', userWalletSchema);

module.exports = { UserWalletModel };
