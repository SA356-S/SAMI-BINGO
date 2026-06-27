import { resolveServerUrl } from './resolveServerUrl';
import {
  getPlayerUserId,
  buildTelegramIdentityQuery,
  buildTelegramAuthHeaders,
} from './playerIdentity';

const API_BASE = resolveServerUrl();

/**
 * Fetches latest wallet balances and taken cartel numbers for the selection grid.
 * Does not affect timer or user selections — data-only refresh.
 */
export async function fetchGameData(userId) {
  const id = userId || getPlayerUserId();
  if (!id) {
    console.error('[game] card-selection skipped — no Telegram user');
    return {
      mainWallet: 0,
      playWallet: 0,
      totalWalletBalance: 0,
      playersCount: 0,
      gameId: null,
      takenCartels: new Set(),
    };
  }

  const query = `?userId=${encodeURIComponent(id)}${buildTelegramIdentityQuery()}`;
  try {
    const res = await fetch(`${API_BASE}/api/game/card-selection${query}`, {
      method: 'GET',
      headers: buildTelegramAuthHeaders(),
    });

    if (!res.ok) {
      throw new Error(`Card selection fetch failed: ${res.status}`);
    }

    const data = await res.json();
    const taken = data.takenCartels ?? data.taken ?? data.occupied ?? [];
    const takenByOthers =
      data.takenByOthers ??
      data.takenByOther ??
      null;

    const mainWallet = Number(data.mainWallet ?? data.wallets?.main ?? 0);
    const playWallet = Number(data.playWallet ?? data.wallets?.play ?? 0);
    const totalFromServer = Number(data.totalWalletBalance ?? data.wallets?.total);

    const myCartels = data.myCartels ?? data.selectedCartels ?? [];

    return {
      mainWallet,
      playWallet,
      totalWalletBalance: Number.isFinite(totalFromServer)
        ? totalFromServer
        : mainWallet + playWallet,
      playersCount: Number(data.playersCount ?? data.players ?? 0),
      gameId: data.gameId ?? null,
      myCartels: Array.isArray(myCartels)
        ? myCartels.map(Number).filter((n) => n >= 1)
        : [],
      selectedCartels: Array.isArray(myCartels)
        ? myCartels.map(Number).filter((n) => n >= 1)
        : [],
      countdownSeconds: Number(
        data.countdownSeconds ?? data.cardSelectionTime ?? 45
      ),
      countdownEndsAt: data.countdownEndsAt ?? null,
      serverTime: data.serverTime ?? null,
      lobbyPhase: data.lobbyPhase ?? data.phase ?? 'COUNTDOWN_RUNNING',
      takenCartels: new Set(
        Array.isArray(takenByOthers)
          ? takenByOthers.map(Number).filter((n) => n >= 1)
          : Array.isArray(taken)
            ? taken.map(Number).filter((n) => n >= 1)
            : []
      ),
      takenByOthers: Array.isArray(takenByOthers)
        ? takenByOthers.map(Number).filter((n) => n >= 1)
        : [],
      selectionLocked: Boolean(data.selectionLocked ?? data.gameInProgress),
      gameInProgress: Boolean(data.gameInProgress ?? data.status === 'calling'),
      gameStatus: data.gameStatus ?? null,
      watchingOnly: Boolean(data.watchingOnly),
      status: data.status ?? 'waiting',
      lobbyRevision: data.lobbyRevision ?? data.selectionVersion ?? null,
      selectionVersion: data.selectionVersion ?? data.lobbyRevision ?? null,
    };
  } catch {
    return {
      mainWallet: 0,
      playWallet: 0,
      totalWalletBalance: 0,
      playersCount: 0,
      gameId: null,
      takenCartels: new Set(),
    };
  }
}

/** @deprecated Use fetchGameData — kept for explicit wallet-only calls */
export async function fetchWallets() {
  const { mainWallet, playWallet } = await fetchGameData();
  return { main: mainWallet, play: playWallet };
}

/** @deprecated Use fetchGameData — kept for explicit grid occupancy calls */
export async function fetchTakenCartels() {
  const { takenCartels } = await fetchGameData();
  return takenCartels;
}
