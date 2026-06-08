const { mongoose } = require('../config/db');

/**
 * Robot identity + configuration (NOT gameplay logic).
 * robotId is namespaced as `robot:<id>` in gameplay to avoid collisions.
 */
const robotProfileSchema = new mongoose.Schema(
  {
    robotId: { type: String, required: true, unique: true, index: true },
    displayName: { type: String, default: '' },
    username: { type: String, default: '' },
    avatarSeed: { type: String, default: '' },
    enabled: { type: Boolean, default: true },
    behavior: { type: String, default: 'default' },
  },
  { timestamps: true }
);

const RobotProfileModel =
  mongoose.models.RobotProfile ||
  mongoose.model('RobotProfile', robotProfileSchema);

module.exports = { RobotProfileModel };

