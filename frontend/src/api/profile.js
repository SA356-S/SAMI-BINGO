import { getSocket } from './socket';
import { resolveServerUrl } from './resolveServerUrl';
import {
  getPlayerUserId,
  getTelegramIdentityPayload,
  buildTelegramIdentityQuery,
  buildTelegramAuthHeaders,
} from './playerIdentity';
import { setSoundEffectsEnabled } from '../utils/soundSettings';

const API_BASE = resolveServerUrl();

const EMPTY_PROFILE = {
  ok: false,
  userId: '',
  username: '',
  initial: '…',
  verified: false,
  mainWallet: 0,
  playWallet: 0,
  gamesPlayed: 0,
  gameWin: 0,
  totalWins: 0,
  totalInvite: 0,
  totalEarned: 0,
  soundEffectsEnabled: true,
  loadError: true,
  authError: false,
};

function normalizeProfile(data = {}) {
  return {
    ok: data.ok !== false,
    userId: data.userId ?? '',
    telegramId: data.telegramId ?? data.userId ?? '',
    username: data.username ?? '',
    firstName: data.firstName ?? '',
    phone: data.phone ?? '',
    initial: data.initial ?? 'P',
    verified: data.verified !== false,
    mainWallet: Math.max(0, Number(data.mainWallet) || 0),
    playWallet: Math.max(0, Number(data.playWallet) || 0),
    gamesPlayed: Math.max(0, Number(data.gamesPlayed) || 0),
    gameWin: Math.max(0, Number(data.gameWin ?? data.totalWins) || 0),
    totalWins: Math.max(0, Number(data.totalWins ?? data.gameWin) || 0),
    totalInvite: Math.max(0, Number(data.totalInvite) || 0),
    totalEarned: Math.max(0, Number(data.totalEarned) || 0),
    soundEffectsEnabled: data.soundEffectsEnabled !== false,
    inviteCode: data.inviteCode ?? '',
    loadError: false,
  };
}

export async function fetchProfile(userId = getPlayerUserId()) {
  const id = userId || getPlayerUserId();
  if (!id) {
    console.error('[profile] skipped — no Telegram user id');
    return { ...EMPTY_PROFILE, loadError: true, authError: true };
  }

  const query = `?userId=${encodeURIComponent(id)}${buildTelegramIdentityQuery()}`;

  try {
    const res = await fetch(`${API_BASE}/api/profile${query}`, {
      headers: {
        Accept: 'application/json',
        ...buildTelegramAuthHeaders(),
      },
    });
    if (!res.ok) {
      throw new Error(`Profile fetch failed: ${res.status}`);
    }
    const data = normalizeProfile(await res.json());
    if (typeof data.soundEffectsEnabled === 'boolean') {
      setSoundEffectsEnabled(data.soundEffectsEnabled);
    }
    console.log('[profile] loaded', {
      userId: id,
      telegramId: data.telegramId,
      username: data.username,
      firstName: data.firstName,
      phone: data.phone ? '(set)' : '(empty)',
      mainWallet: data.mainWallet,
      playWallet: data.playWallet,
    });
    return data;
  } catch (err) {
    console.error('[profile] fetch failed', { userId: id, err });
    return { ...EMPTY_PROFILE, loadError: true, authError: false };
  }
}

export async function updateSoundEffects(
  userId = getPlayerUserId(),
  soundEffectsEnabled
) {
  const id = userId || getPlayerUserId();
  if (!id) throw new Error('telegram_user_required');

  try {
    const res = await fetch(`${API_BASE}/api/profile/settings`, {
      method: 'PATCH',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...buildTelegramAuthHeaders(),
      },
      body: JSON.stringify({ userId: id, soundEffectsEnabled }),
    });
    if (!res.ok) throw new Error(`Profile settings failed: ${res.status}`);
    const data = normalizeProfile(await res.json());
    setSoundEffectsEnabled(data.soundEffectsEnabled);
    return data;
  } catch (err) {
    console.error('[profile] sound settings failed', { userId: id, err });
    throw err;
  }
}

export function subscribeProfileUpdates(userId, onUpdate) {
  const id = userId || getPlayerUserId();
  if (!id) return () => {};

  const socket = getSocket();

  const apply = (payload) => {
    if (payload?.ok === false) return;
    const data = normalizeProfile(payload);
    if (typeof data.soundEffectsEnabled === 'boolean') {
      setSoundEffectsEnabled(data.soundEffectsEnabled);
    }
    onUpdate(data);
  };

  const register = () => {
    socket.emit(
      'profile:get',
      {
        userId: id,
        telegramId: id,
        ...getTelegramIdentityPayload(),
      },
      (ack) => {
        if (ack?.ok !== false) apply(ack);
      }
    );
  };

  socket.on('profile:update', apply);
  if (socket.connected) {
    register();
  } else {
    socket.once('connect', register);
  }

  return () => {
    socket.off('profile:update', apply);
  };
}
