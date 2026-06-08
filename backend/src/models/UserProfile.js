const { mongoose } = require('../config/db');

const userProfileSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, unique: true, index: true },
    phone: { type: String, default: '' },
    verified: { type: Boolean, default: true },
    displayName: { type: String, default: '' },
    soundEffectsEnabled: { type: Boolean, default: true },
    totalInvited: { type: Number, default: 0 },
    totalEarned: { type: Number, default: 0 },
    inviteCode: { type: String, default: '' },
    referredBy: { type: String, default: '' },
    registrationBonusReceived: { type: Boolean, default: false },
  },
  { timestamps: true }
);

userProfileSchema.index({ inviteCode: 1 });

const UserProfileModel =
  mongoose.models.UserProfile ||
  mongoose.model('UserProfile', userProfileSchema);

module.exports = { UserProfileModel };
