const { ROLES, normalizeRole, isPanelRole, isManagerRole } = require('../constants/roles');
const userRoleService = require('../services/userRoleService');

function getAdminToken() {
  return String(process.env.ADMIN_TOKEN || '').trim();
}

function getAdminPassword() {
  return String(process.env.ADMIN_PASSWORD || '').trim();
}

function extractAdminToken(req) {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    return auth.slice(7).trim();
  }
  return req.headers['x-admin-token'] || req.query?.adminToken || '';
}

function extractPanelTelegramId(req) {
  const raw =
    req.headers['x-admin-telegram-id'] ??
    req.headers['x-admin-telegramid'] ??
    req.body?.telegramId ??
    req.query?.telegramId;
  const id = userRoleService.parseTelegramId(raw);
  return id;
}

function requireAdmin(req, res, next) {
  const expected = getAdminToken();
  if (!expected) {
    return res.status(503).json({
      ok: false,
      error: 'admin_not_configured',
      message: 'ADMIN_TOKEN environment variable is required.',
    });
  }

  const token = extractAdminToken(req);
  if (!token || token !== expected) {
    return res.status(401).json({
      ok: false,
      error: 'admin_unauthorized',
      message: 'Invalid or missing admin token',
    });
  }
  next();
}

function verifyAdminToken(token) {
  const expected = getAdminToken();
  return Boolean(expected && token && token === expected);
}

/**
 * After requireAdmin — loads panel operator role from X-Admin-Telegram-Id.
 */
async function attachPanelAdmin(req, res, next) {
  const telegramId = extractPanelTelegramId(req);
  if (!telegramId) {
    return res.status(403).json({
      ok: false,
      error: 'panel_identity_required',
      message: 'Admin Telegram ID is required (X-Admin-Telegram-Id header).',
    });
  }

  try {
    const login = await userRoleService.resolvePanelLogin(telegramId);
    if (!login.ok) {
      const status = login.error === 'user_not_found' ? 404 : 403;
      return res.status(status).json(login);
    }

    req.panelAdmin = {
      telegramId: login.telegramId,
      role: login.role,
      user: login.user,
    };
    return next();
  } catch (err) {
    console.error('[admin] attachPanelAdmin failed', err);
    return res.status(500).json({
      ok: false,
      error: 'panel_auth_failed',
      message: 'Failed to verify admin identity',
    });
  }
}

function requirePanelRole(...allowedRoles) {
  const allowed = new Set(allowedRoles.map((r) => normalizeRole(r)));

  return (req, res, next) => {
    const role = normalizeRole(req.panelAdmin?.role);
    if (!allowed.has(role)) {
      return res.status(403).json({
        ok: false,
        error: 'forbidden',
        message: 'You do not have permission to perform this action.',
        requiredRoles: [...allowed],
        role,
      });
    }
    next();
  };
}

const requireManager = requirePanelRole(ROLES.MANAGER);
const requireAdminOrManager = requirePanelRole(ROLES.ADMIN, ROLES.MANAGER);

function requireManagerOnly(req, res, next) {
  if (!isManagerRole(req.panelAdmin?.role)) {
    return res.status(403).json({
      ok: false,
      error: 'manager_required',
      message: 'Only managers can access this feature.',
    });
  }
  next();
}

module.exports = {
  getAdminToken,
  getAdminPassword,
  ROLES,
  requireAdmin,
  verifyAdminToken,
  extractAdminToken,
  extractPanelTelegramId,
  attachPanelAdmin,
  requirePanelRole,
  requireManager,
  requireAdminOrManager,
  requireManagerOnly,
  isPanelRole,
};
