import { normalizeCalledNumbers } from './socket';

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';

/**
 * Soft refresh for main game — live stats and called balls only.
 * Does not reset cartels or reload the page.
 */
export async function fetchMainGameData(gameId) {
  try {
    const qs = gameId ? `?gameId=${encodeURIComponent(gameId)}` : '';
    const res = await fetch(`${API_BASE}/api/game/main${qs}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
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
