const ROLES = {
  USER: 'user',
  ADMIN: 'admin',
  MANAGER: 'manager',
};

const PANEL_ROLES = [ROLES.ADMIN, ROLES.MANAGER];

function normalizeRole(raw) {
  const r = String(raw || ROLES.USER).toLowerCase().trim();
  if (r === ROLES.ADMIN || r === ROLES.MANAGER) return r;
  return ROLES.USER;
}

function isPanelRole(role) {
  return PANEL_ROLES.includes(normalizeRole(role));
}

function isManagerRole(role) {
  return normalizeRole(role) === ROLES.MANAGER;
}

module.exports = {
  ROLES,
  PANEL_ROLES,
  normalizeRole,
  isPanelRole,
  isManagerRole,
};
