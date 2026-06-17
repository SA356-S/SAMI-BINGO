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
    <ScreenLayout
      activeScreen={activeScreen}
      onNavigate={onNavigate}
      contentVariant="homePlay"
    >
      <section className="w-full shrink-0 text-center">
        <p className="text-[15px] font-medium text-white sm:text-base">
          Welcome to
        </p>
        <h1
          className="mt-1 text-[2.25rem] font-extrabold leading-[1.05] tracking-tight text-[#ffd700] drop-shadow-[0_2px_18px_rgba(255,215,0,0.45)] sm:text-[2.5rem]"
          style={{
            textShadow:
              '0 0 24px rgba(255, 215, 0, 0.35), 0 2px 4px rgba(0, 0, 0, 0.5)',
          }}
        >
          EDIL BINGO
        </h1>
      </section>

      <div className="w-full max-w-[min(100%,320px)] shrink-0 rounded-[1.35rem] border border-white/[0.08] bg-[#12121c]/95 px-5 py-7 shadow-[0_12px_40px_rgba(0,0,0,0.55)] sm:px-6 sm:py-8">
        <p className="text-center text-[10px] font-semibold tracking-[0.22em] text-white/85">
          CHOOSE YOUR STAKE
        </p>

        <div className="relative my-5 h-px w-full sm:my-6">
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-amber-400/70 to-transparent" />
          <div className="absolute inset-0 blur-[2px] bg-gradient-to-r from-transparent via-orange-400/50 to-transparent" />
        </div>

        <button
          type="button"
          onClick={handlePlay10}
          disabled={isEntering}
          className="flex min-h-[50px] w-full touch-manipulation items-center justify-center gap-2.5 rounded-2xl bg-[#00c853] px-4 py-3.5 text-[15px] font-bold tracking-wide text-[#0a0f1d] shadow-[0_8px_28px_rgba(0,200,83,0.45)] transition active:scale-[0.98] disabled:opacity-60 sm:min-h-[52px] sm:text-base"
        >
          <Play
            className="h-5 w-5 shrink-0 fill-[#0a0f1d] text-[#0a0f1d]"
            strokeWidth={0}
          />
          <span className="whitespace-nowrap">
            {isEntering ? 'CHECKING…' : 'PLAY 10'}
          </span>
        </button>

        <div className="mt-7 text-center sm:mt-8">
          <p className="text-[10px] font-medium tracking-[0.2em] text-white/45">
            WALLET BALANCE
          </p>
          <p className="mt-2 text-[2rem] font-bold tabular-nums leading-none text-white sm:text-[2.125rem]">
            {walletLoading ? '…' : totalBalance}
          </p>
        </div>
      </div>
    </ScreenLayout>
  );
}
