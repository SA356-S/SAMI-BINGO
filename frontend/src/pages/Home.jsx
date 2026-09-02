import { useEffect, useState } from 'react';

import { Play } from 'lucide-react';

import { useNavigate } from 'react-router-dom';

import ScreenLayout from '../components/ScreenLayout';

import { fetchPlayerGameStatus } from '../api/gameSession';
import { buildMainGameEntryState } from '../utils/mainGameEntry';
import {
  GAME_STATUS,
  normalizeGameStatus,
  hasEnoughCartelsToPlay,
} from '../utils/gameStatus';
import {
  getPlayerUserId,
  initTelegramWebApp,
  isTelegramWebApp,
} from '../api/playerIdentity';
import { resolveServerUrl } from '../api/resolveServerUrl';

import {
  fetchWalletBalance,
  subscribeWalletUpdates,
} from '../api/wallet';

export default function Home({ activeScreen, onNavigate }) {
  const navigate = useNavigate();

  const [isEntering, setIsEntering] = useState(false);
  const [totalBalance, setTotalBalance] = useState(0);
  const [walletLoading, setWalletLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const userId = getPlayerUserId();
    fetchWalletBalance(userId)
      .then((wallet) => {
        if (!cancelled) setTotalBalance(wallet.totalWalletBalance);
      })
      .finally(() => {
        if (!cancelled) setWalletLoading(false);
      });

    const unsubscribe = subscribeWalletUpdates(userId, (wallet) => {
      setTotalBalance(wallet.totalWalletBalance);
      setWalletLoading(false);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const handlePlay10 = async () => {
    if (isEntering) return;

    initTelegramWebApp();
    setIsEntering(true);

    console.log('[play10] clicked', {
      telegram: isTelegramWebApp(),
      serverUrl: resolveServerUrl(),
    });

    try {
      const status = await fetchPlayerGameStatus();

      if (status?.ok === false && status?.error) {
        console.warn('[play10] status check failed, using card selection', status.error);
        navigate('/card-selection');
        return;
      }

      const gameStatus = normalizeGameStatus(status);
      console.log('[play10] game status from backend', { gameStatus, status });

      if (gameStatus === GAME_STATUS.RUNNING) {
        const canPlay =
          status?.canRejoin !== false &&
          hasEnoughCartelsToPlay(status, 2);

        if (canPlay) {
          console.log('[play10] rejoining running game as player', status.gameId);
          navigate('/main-game', {
            replace: true,
            state: {
              rejoin: true,
              gameId: status.gameId,
              selectedCartels: status.myCartels ?? status.selectedCartels ?? [],
              cards: status.myCards ?? status.cards ?? [],
              playersCount: status.playersCount ?? 0,
              stake: status.stake ?? status.bet ?? 10,
              calledNumbers: status.calledNumbers ?? status.called ?? [],
              manualMarks: status.manualMarks,
              automatic: status.automatic ?? true,
            },
          });
          return;
        }

        navigate('/main-game', {
          replace: true,
          state: {
            ...buildMainGameEntryState({
              selectedCartels: [],
              gameId: status.gameId,
              playersCount: status.playersCount ?? 0,
              stake: status.stake ?? status.bet ?? 10,
            }),
            calledNumbers:
              status.calledNumbers ?? status.called ?? status.balls ?? [],
            automatic: status.automatic ?? true,
          },
        });
        return;
      }

      console.log('[play10] lobby open — card selection', { gameStatus });
      navigate('/card-selection');
    } catch (err) {
      console.warn('[play10] could not resolve game status, opening card selection', err);
      navigate('/card-selection');
    } finally {
      setIsEntering(false);
    }
  };

  return (
    <ScreenLayout activeScreen={activeScreen} onNavigate={onNavigate}>
      <section className="w-full shrink-0 text-center">
        <h1 className="mx-auto max-w-[min(100%,280px)] text-[1.5rem] font-extrabold leading-[1.2] sm:text-[1.875rem]">
          <span className="block bg-gradient-to-r from-amber-200 via-amber-400 to-amber-600 bg-clip-text text-transparent">
            Welcome to
          </span>
          <span className="mt-0.5 block bg-gradient-to-r from-amber-300 via-yellow-400 to-amber-500 bg-clip-text text-transparent">
            CAPITAL BINGO
          </span>
        </h1>
      </section>

      <div className="w-full max-w-sm shrink-0 rounded-3xl border border-white/[0.08] bg-white/[0.04] px-5 py-8 shadow-[0_0_40px_rgba(16,185,129,0.08),0_8px_32px_rgba(0,0,0,0.5)] backdrop-blur-md sm:px-8 sm:py-10">
        <p className="text-center text-[11px] font-semibold tracking-[0.2em] text-white/70">
          CHOOSE YOUR STAKE
        </p>

        <div className="relative my-6 h-px w-full">
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-emerald-400/60 to-transparent" />
          <div className="absolute inset-0 blur-sm bg-gradient-to-r from-transparent via-emerald-300/40 to-transparent" />
        </div>

        <button
          type="button"
          onClick={handlePlay10}
          disabled={isEntering}
          className="group relative flex min-h-[48px] w-full touch-manipulation items-center justify-center gap-3 overflow-hidden rounded-2xl bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500 px-4 py-3.5 text-sm font-bold tracking-wide text-white shadow-[0_4px_24px_rgba(16,185,129,0.45)] transition active:scale-[0.98] hover:shadow-[0_6px_32px_rgba(16,185,129,0.55)] disabled:opacity-60 sm:py-4 sm:text-base"
        >
          <span className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/20 to-white/0 opacity-0 transition group-hover:opacity-100" />
          <Play
            className="relative h-5 w-5 shrink-0 fill-white"
            strokeWidth={0}
          />
          <span className="relative whitespace-nowrap">
            {isEntering ? 'CHECKING…' : 'PLAY 10'}
          </span>
        </button>

        <div className="mt-8 border-t border-white/[0.06] pt-6 text-center">
          <p className="text-[10px] font-medium tracking-[0.2em] text-white/45">
            WALLET BALANCE
          </p>
          <p className="mt-1.5 text-2xl font-bold tabular-nums leading-none text-white sm:text-3xl">
            {walletLoading ? '…' : totalBalance}
          </p>
          <p className="mt-1 text-[9px] text-white/30">Main + Play wallet (ETB)</p>
        </div>
      </div>
    </ScreenLayout>
  );
}
