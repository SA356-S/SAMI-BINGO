const { mongoose } = require('../config/db');

const depositSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    /** Normalized transaction/reference — unique so a ref can never credit twice. */
    transactionId: { type: String, required: true, unique: true },
    provider: {
      type: String,
      enum: ['telebirr', 'cbe'],
      required: true,
      index: true,
    },
    paymentMethod: { type: String, default: 'telebirr' },
    source: {
      type: String,
      enum: ['bot', 'miniapp'],
      default: 'miniapp',
    },

    requestedAmount: { type: Number, required: true, min: 0 },
    verifiedAmount: { type: Number, default: null, min: 0 },
    submittedAmount: { type: Number, required: true, min: 0 },
    amount: { type: Number, required: true, min: 0 },

    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
      index: true,
    },
    walletCredited: { type: Boolean, default: false, index: true },

    receivingNumber: { type: String, default: '' },
    receiverName: { type: String, default: '' },
    receiverAccount: { type: String, default: '' },

    qbirrVerified: { type: Boolean, default: false },
    qbirrPayer: { type: String, default: '' },
    qbirrAmount: { type: Number, default: null },
    qbirrError: { type: String, default: '' },

    senderName: { type: String, default: '' },
    paymentStatus: { type: String, default: '' },
    receiptLink: { type: String, default: '' },
    officialPaymentLink: { type: String, default: '' },
    proofText: { type: String, default: '' },
    transactionDate: { type: String, default: '' },

    verifiedAt: { type: Date, default: null },
    rejectionReason: { type: String, default: '' },
  },
  { timestamps: true }
);

const DepositModel =
  mongoose.models.Deposit || mongoose.model('Deposit', depositSchema);

module.exports = { DepositModel };
