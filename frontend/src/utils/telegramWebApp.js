/** Cached session after successful Telegram auth (survives re-read timing issues). */
let cachedTelegramUser = null;
let cachedTelegramUserId = null;

/** @returns {boolean} */
export function isTelegramWebApp() {
  return typeof window !== 'undefined' && Boolean(window.Telegram?.WebApp);
}

function parseUserFromInitData(initData) {
  if (!initData || typeof initData !== 'string') return null;
  try {
    const params = new URLSearchParams(initData);
    const raw = params.get('user');
    if (!raw) return null;
    const user = JSON.parse(raw);
    return user?.id != null ? user : null;
  } catch {
    return null;
  }
}

/**
 * Primary source: Telegram.WebApp.initDataUnsafe.user
 * Fallback: parse signed initData string
 */
export function getTelegramUser() {
  if (typeof window === 'undefined') return null;

  const webApp = window.Telegram?.WebApp;
  if (!webApp) return cachedTelegramUser;

  const unsafeUser = webApp.initDataUnsafe?.user;
  if (unsafeUser?.id != null) return unsafeUser;

  const parsed = parseUserFromInitData(webApp.initData);
  if (parsed?.id != null) return parsed;

  return cachedTelegramUser;
}

export function getTelegramInitData() {
  if (typeof window === 'undefined') return '';
  return window.Telegram?.WebApp?.initData || '';
}

export function setTelegramSession(user, userId) {
  if (user?.id != null) {
    cachedTelegramUser = user;
  }
  if (userId != null && String(userId).trim() !== '') {
    cachedTelegramUserId = String(userId).trim();
  }
  console.log('[telegram] session cached', {
    userId: cachedTelegramUserId,
    username: cachedTelegramUser?.username ?? null,
  });
}

export function getCachedTelegramUserId() {
  return cachedTelegramUserId;
}

export function formatTelegramUsername(user = getTelegramUser()) {
  if (!user) return '';
  if (user.username) {
    const bare = String(user.username).replace(/^@/, '').trim();
    if (bare) return `@${bare}`;
  }
  if (user.first_name) return String(user.first_name).trim();
  if (user.id != null) return `User ${user.id}`;
  return '';
}

export function getTelegramIdentityPayload() {
  const user = getTelegramUser();
  const initData = getTelegramInitData();
  const telegramId =
    cachedTelegramUserId ??
    (user?.id != null ? String(user.id) : undefined);

  return {
    telegramId,
    firstName: user?.first_name ? String(user.first_name) : undefined,
    lastName: user?.last_name ? String(user.last_name) : undefined,
    username: user?.username ? String(user.username) : undefined,
    initData: initData || undefined,
  };
}

/**
 * @returns {string|null} Numeric Telegram user id only — never a dev/mock id.
 */
export function getGameplayUserId() {
  if (cachedTelegramUserId) return cachedTelegramUserId;

  const user = getTelegramUser();
  if (user?.id != null && String(user.id).trim() !== '') {
    return String(user.id);
  }

  if (isTelegramWebApp()) {
    return null;
  }

  return null;
}

export function hasRealTelegramUser() {
  return getGameplayUserId() != null;
}

export async function ensureTelegramIdentity({ maxWaitMs = 8000 } = {}) {
  initTelegramWebApp();

  const started = Date.now();
  while (Date.now() - started < maxWaitMs) {
    const webApp = window.Telegram?.WebApp;
    const unsafeUser = webApp?.initDataUnsafe?.user;
    const user = unsafeUser?.id != null ? unsafeUser : getTelegramUser();

    if (user?.id != null) {
      const userId = String(user.id);
      setTelegramSession(user, userId);
      console.log('[telegram] user received (initDataUnsafe)', {
        id: userId,
        username: user.username ?? null,
        first_name: user.first_name ?? null,
        last_name: user.last_name ?? null,
      });
      return { user, userId };
    }
    await new Promise((r) => setTimeout(r, 50));
  }

  if (isTelegramWebApp()) {
    throw new Error('telegram_user_unavailable');
  }

  throw new Error('telegram_user_required');
}

export function buildTelegramIdentityQuery() {
  const userId = getGameplayUserId();
  const user = getTelegramUser();
  const params = new URLSearchParams();
  if (userId) params.set('userId', userId);
  if (userId) params.set('telegramId', userId);
  if (user?.first_name) params.set('firstName', String(user.first_name));
  if (user?.last_name) params.set('lastName', String(user.last_name));
  if (user?.username) params.set('username', String(user.username));
  const qs = params.toString();
  return qs ? `&${qs}` : '';
}

export function buildTelegramAuthHeaders() {
  const initData = getTelegramInitData();
  const headers = { Accept: 'application/json' };
  if (initData) headers['X-Telegram-Init-Data'] = initData;
  return headers;
}

export function initTelegramWebApp() {
  const webApp = window.Telegram?.WebApp;
  if (!webApp) return null;

  try {
    webApp.ready();
    webApp.expand?.();
  } catch (err) {
    console.warn('[telegram] WebApp.ready failed', err);
  }

  return webApp;
}
