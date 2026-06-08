import {
  ensureTelegramIdentity,
  getTelegramIdentityPayload,
  getTelegramUser,
  initTelegramWebApp,
  buildTelegramAuthHeaders,
} from '../api/playerIdentity';
import { connectSocketWithTelegramAuth } from '../api/socket';
import { resolveServerUrl } from '../api/resolveServerUrl';

const API_BASE = resolveServerUrl();

let lastBootstrapUserId = null;
let lastProfile = null;
let lastWallet = null;

/**
 * Telegram Bot → Mini App → Backend → Database session bootstrap.
 */
export async function bootstrapPlayerSession() {
  initTelegramWebApp();

  const { user, userId } = await ensureTelegramIdentity();
  connectSocketWithTelegramAuth();

  const identity = getTelegramIdentityPayload();

  console.log('[telegram] bootstrap — sending auth to backend', { userId });

  const res = await fetch(`${API_BASE}/api/auth/session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...buildTelegramAuthHeaders(),
    },
    body: JSON.stringify(identity),
  });

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    console.error('[telegram] backend auth failed', res.status, errBody);
    const err = new Error(errBody.message ?? errBody.error ?? 'telegram_auth_failed');
    err.code = errBody.error;
    err.banReason = errBody.banReason;
    throw err;
  }

  const data = await res.json();
  lastBootstrapUserId = userId;
  lastProfile = data.profile ?? null;
  lastWallet = data.wallet ?? null;

  console.log('[telegram] backend auth success', {
    userId,
    username: lastProfile?.username,
    phone: lastWallet?.phone ? '(set)' : '(empty)',
    databaseUser: Boolean(data.ok),
  });

  if (!lastWallet?.phone) {
    console.log('[telegram] phone not set — share contact in Telegram bot', {
      userId,
    });
  }

  return {
    userId,
    user: user ?? getTelegramUser(),
    profile: lastProfile,
    wallet: lastWallet,
    ok: data.ok !== false,
  };
}

export function getLastBootstrapUserId() {
  return lastBootstrapUserId;
}

export function getCachedProfile() {
  return lastProfile;
}

export function getCachedWallet() {
  return lastWallet;
}
