const crypto = require('crypto');

/**
 * Resolve Telegram user id from verified Mini App initData only.
 * @see https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */

function getBotToken() {
  return String(process.env.BOT_TOKEN || process.env.GAME_BOT_TOKEN || '').trim();
}

function parseInitDataUser(initData) {
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

function isValidTelegramId(id) {
  if (id == null || id === '') return false;
  const n = Number(id);
  return Number.isFinite(n) && n > 0 && String(Math.trunc(n)) === String(id).trim();
}

function headerInitData(headers = {}) {
  return (
    headers['x-telegram-init-data'] ??
    headers['X-Telegram-Init-Data'] ??
    ''
  );
}

function collectInitDataString(sources = {}) {
  const { payload = {}, auth = {}, headers = {}, query = {}, data = {}, body = {} } =
    sources;

  return (
    auth.initData ??
    data.initData ??
    body.initData ??
    headerInitData(headers) ??
    query.initData ??
    payload.initData ??
    ''
  );
}

/**
 * Validate Telegram WebApp initData HMAC.
 * @returns {{ ok: true, user: object|null, authDate: number|null } | { ok: false, error: string }}
 */
function getInitDataMaxAgeSec() {
  const configured = Number(process.env.TELEGRAM_INIT_DATA_MAX_AGE_SEC);
  if (Number.isFinite(configured) && configured > 0) {
    return configured;
  }
  return 86400;
}

function validateInitData(initData, botToken = getBotToken()) {
  const raw = String(initData || '').trim();
  if (!raw) {
    return { ok: false, error: 'missing_init_data' };
  }

  const token = String(botToken || '').trim();
  if (!token) {
    return { ok: false, error: 'missing_bot_token' };
  }

  try {
    const params = new URLSearchParams(raw);
    const hash = params.get('hash');
    if (!hash) {
      return { ok: false, error: 'missing_hash' };
    }

    const pairs = [];
    for (const [key, value] of params.entries()) {
      if (key === 'hash') continue;
      pairs.push(`${key}=${value}`);
    }
    pairs.sort();
    const dataCheckString = pairs.join('\n');

    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
    const calculatedHash = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    if (calculatedHash !== hash) {
      return { ok: false, error: 'invalid_hash' };
    }

    const authDate = Number(params.get('auth_date'));
    if (!Number.isFinite(authDate) || authDate <= 0) {
      return { ok: false, error: 'missing_auth_date' };
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const ageSec = nowSec - authDate;
    const maxAgeSec = getInitDataMaxAgeSec();

    if (ageSec > maxAgeSec) {
      return { ok: false, error: 'init_data_expired' };
    }

    if (ageSec < -300) {
      return { ok: false, error: 'init_data_from_future' };
    }

    const user = parseInitDataUser(raw);

    return {
      ok: true,
      user,
      authDate,
    };
  } catch {
    return { ok: false, error: 'parse_failed' };
  }
}

/**
 * @returns {{ userId: string, user: object|null, source: 'initData' } | null}
 */
function resolveTelegramUserId(sources = {}) {
  const initData = collectInitDataString(sources);
  if (!initData) return null;

  const validation = validateInitData(initData);
  if (!validation.ok) return null;

  const user = validation.user ?? parseInitDataUser(initData);
  if (user?.id != null && isValidTelegramId(user.id)) {
    return {
      userId: String(user.id),
      user,
      source: 'initData',
    };
  }

  return null;
}

function resolveTelegramUserIdFromHandshake(handshake = {}) {
  return resolveTelegramUserId({
    auth: handshake.auth ?? {},
    headers: handshake.headers ?? {},
  });
}

function attachTelegramUserFromRequest(req, _res, next) {
  const resolved = resolveTelegramUserId({
    query: req.query,
    headers: req.headers,
    body: req.body,
  });

  if (resolved?.userId) {
    req.telegramUserId = resolved.userId;
    req.telegramUserFromInit = resolved.user;
    console.log('[telegram] API user resolved', {
      userId: resolved.userId,
      source: resolved.source,
      path: req.path,
    });
  }

  next();
}

function requireTelegramUserId(req, res, next) {
  if (!isValidTelegramId(req.telegramUserId)) {
    return res.status(401).json({
      ok: false,
      error: 'telegram_auth_required',
      message: 'Open this app from Telegram to load your account.',
    });
  }

  req.telegramUserId = String(req.telegramUserId).trim();
  next();
}

/** Gameplay/socket: verified Telegram id only — never socket.id or unverified fields. */
function resolveGameplayUserId(socket, payload = {}) {
  const resolved = resolveTelegramUserId({
    payload,
    auth: socket.handshake?.auth ?? {},
    data: socket.data ?? {},
  });

  return resolved?.userId ?? null;
}

module.exports = {
  parseInitDataUser,
  isValidTelegramId,
  validateInitData,
  resolveTelegramUserId,
  resolveTelegramUserIdFromHandshake,
  resolveGameplayUserId,
  attachTelegramUserFromRequest,
  requireTelegramUserId,
};
