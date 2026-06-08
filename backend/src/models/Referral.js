const { mongoose } = require('../config/db');

const referralSchema = new mongoose.Schema(
  {
    referrerUserId: { type: String, required: true, index: true },
    referredUserId: { type: String, required: true, unique: true, index: true },
    referralCode: { type: String, default: '' },
    joinedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

const ReferralModel =
  mongoose.models.Referral || mongoose.model('Referral', referralSchema);

module.exports = { ReferralModel };
