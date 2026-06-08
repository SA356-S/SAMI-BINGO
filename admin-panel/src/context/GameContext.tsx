import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  fetchDashboard,
  fetchGameState,
  startGame as apiStart,
  stopGame as apiStop,
  drawNumber as apiDraw,
  resetGame as apiReset,
} from '../services/api';
import {
  subscribeGameUpdates,
  subscribeNumberDraws,
} from '../services/socket';
import type { GameSnapshot } from '../types';

interface GameContextValue {
  game: GameSnapshot | null;
  loading: boolean;
  actionLoading: string | null;
  refresh: () => Promise<void>;
  startGame: () => Promise<void>;
  stopGame: () => Promise<void>;
  drawNumber: () => Promise<void>;
  resetGame: () => Promise<void>;
  lastDrawn: number | null;
}

const GameContext = createContext<GameContextValue | null>(null);

export function GameProvider({ children }: { children: ReactNode }) {
  const [game, setGame] = useState<GameSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [lastDrawn, setLastDrawn] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const dash = await fetchDashboard();
      setGame(dash.game);
    } catch (err) {
      console.error('[admin] refresh failed', err);
      const state = await fetchGameState();
      setGame(state);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const unsubGame = subscribeGameUpdates((g) => {
      setGame(g);
      setLoading(false);
    });
    const unsubNum = subscribeNumberDraws((p) => {
      setLastDrawn(p.number);
      setGame((prev) =>
        prev
          ? {
              ...prev,
              latestBall: p.number,
              calledNumbers: p.calledNumbers.length
                ? p.calledNumbers
                : [...prev.calledNumbers, p.number],
            }
          : prev
      );
    });
    return () => {
      unsubGame();
      unsubNum();
    };
  }, [refresh]);

  const wrapAction = async (key: string, fn: () => Promise<{ game: GameSnapshot }>) => {
    setActionLoading(key);
    try {
      const res = await fn();
      if (res.game) setGame(res.game);
    } finally {
      setActionLoading(null);
    }
  };

  const value = useMemo(
    () => ({
      game,
      loading,
      actionLoading,
      lastDrawn,
      refresh,
      startGame: () => wrapAction('start', () => apiStart(game?.gameId)),
      stopGame: () => wrapAction('stop', () => apiStop(game?.gameId)),
      drawNumber: () =>
        wrapAction('draw', async () => {
          const res = await apiDraw(game?.gameId);
          if (res.number != null) setLastDrawn(res.number);
          return res;
        }),
      resetGame: () => wrapAction('reset', () => apiReset(game?.gameId)),
    }),
    [game, loading, actionLoading, lastDrawn, refresh]
  );

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export function useGame() {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error('useGame outside GameProvider');
  return ctx;
}
