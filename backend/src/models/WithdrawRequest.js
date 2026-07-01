const { mongoose } = require('../config/db');

const withdrawRequestSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    amount: { type: Number, required: true, min: 0 },
    paymentMethod: { type: String, required: true },
    phone: { type: String, required: true },
    accountName: { type: String, required: true },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
      index: true,
    },
    telegramUsername: { type: String, default: '' },
    telegramFirstName: { type: String, default: '' },
    mainWalletAtRequest: { type: Number, default: 0 },
  },
  { timestamps: true }
);

withdrawRequestSchema.index(
  { userId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'pending' },
    name: 'one_pending_withdraw_per_user',
  }
);

const WithdrawRequestModel =
  mongoose.models.WithdrawRequest ||
  mongoose.model('WithdrawRequest', withdrawRequestSchema);

module.exports = { WithdrawRequestModel };
