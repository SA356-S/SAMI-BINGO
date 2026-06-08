/**

 * Resolve Telegram user id from Mini App initData, headers, or explicit auth fields.

 */



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



/**

 * @returns {{ userId: string, user: object|null, source: string } | null}

 */

function resolveTelegramUserId(sources = {}) {

  const { payload = {}, auth = {}, headers = {}, query = {}, data = {} } = sources;



  const initData =

    auth.initData ?? data.initData ?? headerInitData(headers) ?? query.initData;



  const fromInit = parseInitDataUser(initData);

  if (fromInit?.id != null && isValidTelegramId(fromInit.id)) {

    return {

      userId: String(fromInit.id),

      user: fromInit,

      source: 'initData',

    };

  }



  const candidates = [

    data.telegramUserId,

    data.userId,

    payload.telegramId,

    payload.userId,

    auth.telegramId,

    auth.userId,

    query.telegramId,

    query.userId,

  ];



  for (const candidate of candidates) {

    if (isValidTelegramId(candidate)) {

      return {

        userId: String(candidate).trim(),

        user: null,

        source: 'explicit',

      };

    }

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

  const userId = req.telegramUserId ?? req.query?.userId;

  if (!isValidTelegramId(userId)) {

    return res.status(401).json({

      ok: false,

      error: 'telegram_auth_required',

      message: 'Open this app from Telegram to load your account.',

    });

  }

  req.telegramUserId = String(userId).trim();

  next();

}



/** Gameplay/socket: only numeric Telegram ids — never socket.id or dev placeholders. */

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

  resolveTelegramUserId,

  resolveTelegramUserIdFromHandshake,

  resolveGameplayUserId,

  attachTelegramUserFromRequest,

  requireTelegramUserId,

};


