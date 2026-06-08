import { getSocket } from './socket';
import { resolveServerUrl } from './resolveServerUrl';
import {
  getPlayerUserId,
  buildTelegramIdentityQuery,
  buildTelegramAuthHeaders,
} from './playerIdentity';

const API_BASE = resolveServerUrl();

async function getJson(path, userId = getPlayerUserId()) {
  const id = userId || getPlayerUserId();
  if (!id) throw new Error('telegram_user_required');

  const query = `?userId=${encodeURIComponent(id)}${buildTelegramIdentityQuery()}`;
  const res = await fetch(`${API_BASE}${path}${query}`, {
    headers: buildTelegramAuthHeaders(),
  });
  if (!res.ok) {
    throw new Error(`Request failed: ${res.status}`);
  }
  return res.json();
}

/** Home dashboard: wallet, player stats, lobby, active game */
export async function fetchHomeDashboard(userId = getPlayerUserId()) {
  try {
    return await getJson('/api/stats/home', userId);
  } catch (err) {
    console.warn('[stats] home fetch failed', err);
    return null;
  }
}

/** Score page: leaderboard + my rank */
export async function fetchScoreboard(
  period = 'daily',
  userId = getPlayerUserId()
) {
  const id = userId || getPlayerUserId();
  try {
    const res = await fetch(
      `${API_BASE}/api/stats/score?userId=${encodeURIComponent(id)}&period=${period}${buildTelegramIdentityQuery()}`,
      { headers: buildTelegramAuthHeaders() }
    );
    if (!res.ok) throw new Error(`Score fetch failed: ${res.status}`);
    return res.json();
  } catch (err) {
    console.warn('[stats] score fetch failed', err);
    return null;
  }
}

/** Game history list */
export async function fetchGameHistory(userId = getPlayerUserId()) {
  try {
    return await getJson('/api/stats/history', userId);
  } catch (err) {
    console.warn('[stats] history fetch failed', err);
    return { summary: { totalPlayed: 0, totalWins: 0 }, items: [] };
  }
}

/** Live stats refresh after games finish */
export function subscribeStatsUpdates(onUpdate) {
  const socket = getSocket();
  const handler = () => onUpdate();
  socket.on('stats:update', handler);
  return () => socket.off('stats:update', handler);
}
