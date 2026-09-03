const { mongoose } = require('../config/db');

const manualDepositSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    telegramUsername: { type: String, default: '' },
    telegramFirstName: { type: String, default: '' },
    telegramLastName: { type: String, default: '' },

    /** User-provided amount — untrusted hint only. Admin must confirm. */
    submittedAmount: { type: Number, default: null, min: 0 },
    approvedAmount: { type: Number, default: null, min: 0 },

    photoFileId: { type: String, required: true },
    photoFileUniqueId: { type: String, default: '' },
    photoWidth: { type: Number, default: null },
    photoHeight: { type: Number, default: null },
    photoCaption: { type: String, default: '' },

    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
      index: true,
    },
    walletCredited: { type: Boolean, default: false, index: true },

    reviewedAt: { type: Date, default: null },
    reviewedByTelegramId: { type: String, default: '' },
    reviewedByRole: { type: String, default: '' },
  },
  { timestamps: true }
);

manualDepositSchema.index(
  { userId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'pending' },
    name: 'one_pending_manual_deposit_per_user',
  }
);

const ManualDepositModel =
  mongoose.models.ManualDeposit || mongoose.model('ManualDeposit', manualDepositSchema);

module.exports = { ManualDepositModel };
