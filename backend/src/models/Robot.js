const { mongoose } = require('../config/db');

/**
 * Admin-managed robot players (`robots` collection).
 * Gameplay uses robotId = `robot:<_id>`.
 */
const robotSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    status: { type: String, enum: ['on', 'off'], default: 'off' },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'robots',
  }
);

robotSchema.index({ name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });

const RobotModel =
  mongoose.models.ManagedRobot || mongoose.model('ManagedRobot', robotSchema);

module.exports = { RobotModel };
