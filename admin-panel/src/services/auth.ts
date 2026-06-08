const TOKEN_KEY = 'edil_bingo_admin_token';
const TELEGRAM_ID_KEY = 'edil_bingo_admin_telegram_id';
const ROLE_KEY = 'edil_bingo_admin_role';

export type AdminRole = 'admin' | 'manager';

export function getAdminToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getAdminTelegramId(): string | null {
  return localStorage.getItem(TELEGRAM_ID_KEY);
}

export function getAdminRole(): AdminRole | null {
  const role = localStorage.getItem(ROLE_KEY);
  if (role === 'admin' || role === 'manager') return role;
  return null;
}

export function setAdminSession(token: string, telegramId: string | number, role: AdminRole) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(TELEGRAM_ID_KEY, String(telegramId));
  localStorage.setItem(ROLE_KEY, role);
}

export function setAdminToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearAdminToken() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(TELEGRAM_ID_KEY);
  localStorage.removeItem(ROLE_KEY);
}

export function isAuthenticated(): boolean {
  return Boolean(getAdminToken() && getAdminTelegramId() && getAdminRole());
}

export function isManager(): boolean {
  return getAdminRole() === 'manager';
}

export function isAdminRole(): boolean {
  return getAdminRole() === 'admin';
}
