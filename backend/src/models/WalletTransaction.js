const { mongoose } = require('../config/db');

const walletTransactionSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    type: {
      type: String,
      enum: ['deposit', 'withdraw'],
      required: true,
    },
    amount: { type: Number, required: true },
    detail: { type: String, default: '' },
    reference: { type: String, default: '' },
    channel: { type: String, default: 'TELE' },
    createdAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

const WalletTransactionModel =
  mongoose.models.WalletTransaction ||
  mongoose.model('WalletTransaction', walletTransactionSchema);

module.exports = { WalletTransactionModel };
