const { mongoose } = require('../config/db');

/**
 * Singleton robot system configuration + robot bank balance.
 */
const robotConfigSchema = new mongoose.Schema(
  {
    configId: { type: String, required: true, unique: true, index: true },
    enabledGlobal: { type: Boolean, default: true },

    minCards: { type: Number, default: 2 },
    maxCards: { type: Number, default: 2 },
    maxActiveRobots: { type: Number, default: 10 },
    activityLevel: { type: Number, default: 1 }, // 0..1 scale (engine uses as multiplier)

    joinJitterMs: { type: Number, default: 15000 },
    leaveJitterMs: { type: Number, default: 20000 },

    /**
     * Robot bank balance.
     * Robot stake charging uses this balance instead of human wallets.
     */
    bankBalance: { type: Number, default: 10000, min: 0 },
  },
  { timestamps: true }
);

const RobotConfigModel =
  mongoose.models.RobotConfig || mongoose.model('RobotConfig', robotConfigSchema);

module.exports = { RobotConfigModel };

