const { mongoose } = require('../config/db');

/**
 * Singleton app settings (MongoDB `settings` collection).
 */
const settingsSchema = new mongoose.Schema(
  {
    settingsId: { type: String, required: true, unique: true, index: true },
    /** 0 = fair speed, 100 = maximum robot timing advantage */
    robotAdvantageLevel: { type: Number, default: 0, min: 0, max: 100 },
    /** Card selection lobby countdown duration (seconds), admin range 1–100 */
    cardSelectionTime: { type: Number, default: null, min: 1, max: 100 },
    /** Registration welcome bonus — admin controlled */
    registrationBonusEnabled: { type: Boolean, default: false },
    registrationBonusAmount: { type: Number, default: 0, min: 0 },
    /** One-time first approved deposit bonus — admin controlled */
    firstDepositBonusEnabled: { type: Boolean, default: false },
    firstDepositBonusPercent: { type: Number, default: 100 },
    /** Telegram bot Manual Deposit command — independent of automatic deposits */
    manualDepositEnabled: { type: Boolean, default: true },
  },
  { timestamps: true, collection: 'settings' }
);

const SettingsModel =
  mongoose.models.Settings || mongoose.model('Settings', settingsSchema);

module.exports = { SettingsModel };
