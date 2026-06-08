const { mongoose } = require('../config/db');

const notificationSchema = new mongoose.Schema(
  {
    imageUrl: { type: String, default: '' },
    message: { type: String, required: true, trim: true },
    buttonText: { type: String, default: '' },
    buttonLink: { type: String, default: '' },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'notifications',
  }
);

const NotificationModel =
  mongoose.models.Notification ||
  mongoose.model('Notification', notificationSchema);

module.exports = { NotificationModel };
