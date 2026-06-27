import { normalizeCalledNumbers } from './socket';
import {
  buildTelegramAuthHeaders,
  buildTelegramIdentityQuery,
  getPlayerUserId,
} from './playerIdentity';

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

/**
 * Soft refresh for main game — live stats and called balls only.
 * Does not reset cartels or reload the page.
 */
export async function fetchMainGameData(gameId) {
  try {
    const userId = getPlayerUserId();
    const qsBase = gameId ? `gameId=${encodeURIComponent(gameId)}` : '';
    const identity = buildTelegramIdentityQuery();
    const qs = [qsBase, identity.replace(/^\?/, '')].filter(Boolean).join('&');
    const res = await fetch(`${API_BASE}/api/game/main${qs ? `?${qs}` : ''}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...buildTelegramAuthHeaders(),
      },
    });

    if (!res.ok) {
      throw new Error(`Main game fetch failed: ${res.status}`);
    }

    const data = await res.json();

    return {
      playersCount: Number(data.playersCount ?? data.players ?? 0),
      derash: Number(data.derash ?? data.pot ?? 0),
      calledNumbers: normalizeCalledNumbers(data),
      gameId: data.gameId ?? null,
      status: data.status ?? null,
    };
  } catch {
    return null;
  }
}
