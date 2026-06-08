import {
  getGameplayUserId,
  getTelegramUser,
  getTelegramIdentityPayload,
  getTelegramInitData,
  formatTelegramUsername,
  buildTelegramIdentityQuery,
  buildTelegramAuthHeaders,
  ensureTelegramIdentity,
  hasRealTelegramUser,
  isTelegramWebApp,
  initTelegramWebApp,
  setTelegramSession,
  getCachedTelegramUserId,
} from '../utils/telegramWebApp';

/** Canonical user id — numeric Telegram id only. */
export function getPlayerUserId() {
  return getGameplayUserId();
}

export {
  getTelegramUser,
  getTelegramInitData,
  getTelegramIdentityPayload,
  formatTelegramUsername,
  buildTelegramIdentityQuery,
  buildTelegramAuthHeaders,
  ensureTelegramIdentity,
  hasRealTelegramUser,
  isTelegramWebApp,
  initTelegramWebApp,
  setTelegramSession,
  getCachedTelegramUserId,
};
