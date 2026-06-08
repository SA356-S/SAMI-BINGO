const { mongoose } = require('../config/db');

const REGISTRATION_STATUSES = ['pending', 'registered'];
const USER_ROLES = ['user', 'admin', 'manager'];

const telegramUserSchema = new mongoose.Schema(
  {
    telegramId: { type: Number, required: true, unique: true, index: true },
    /** Telegram chat id for Bot API (private chat = telegramId). */
    chatId: { type: Number, index: true },
    phoneNumber: { type: String, default: '' },
    username: { type: String, default: '' },
    firstName: { type: String, default: '' },
    lastName: { type: String, default: '' },
    registrationStatus: {
      type: String,
      enum: REGISTRATION_STATUSES,
      default: 'pending',
      index: true,
    },
    role: {
      type: String,
      enum: USER_ROLES,
      default: 'user',
      index: true,
    },
    isBanned: { type: Boolean, default: false, index: true },
    banReason: { type: String, default: '' },
    bannedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

const TelegramUserModel =
  mongoose.models.TelegramUser ||
  mongoose.model('TelegramUser', telegramUserSchema);

module.exports = {
  TelegramUserModel,
  REGISTRATION_STATUSES,
  USER_ROLES,
};
