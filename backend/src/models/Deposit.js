const { mongoose } = require('../config/db');

const depositSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    transactionId: { type: String, required: true, unique: true, index: true },
    paymentMethod: { type: String, default: 'telebirr' },

    /** Amount user selected in bot (reference only — never used for credit). */
    submittedAmount: { type: Number, required: true, min: 0 },
    /** Amount extracted from official receipt (source of truth for credit). */
    verifiedAmount: { type: Number, default: null, min: 0 },
    /** @deprecated use verifiedAmount; kept for backward compatibility. */
    amount: { type: Number, required: true, min: 0 },

    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
      index: true,
    },

    receiptLink: { type: String, default: '' },
    officialPaymentLink: { type: String, default: '' },
    senderName: { type: String, default: '' },
    receiverName: { type: String, default: '' },
    receiverAccount: { type: String, default: '' },
    paymentStatus: { type: String, default: '' },
    transactionDate: { type: String, default: '' },

    proofText: { type: String, default: '' },
    verifiedAt: { type: Date, default: null },
    rejectionReason: { type: String, default: '' },
  },
  { timestamps: true }
);

const DepositModel =
  mongoose.models.Deposit || mongoose.model('Deposit', depositSchema);

module.exports = { DepositModel };
