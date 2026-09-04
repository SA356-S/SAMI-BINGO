import { useCallback, useEffect, useMemo, useState, memo } from 'react';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { fetchGameData } from '../api/cardSelection';
import { applyWalletSnapshot, getSocket } from '../api/socket';
import BingoGrid from '../components/BingoGrid';
import Navbar from '../components/Navbar';
import {
  getLobbyState,
  subscribeLobby,
  toggleCartelSelection,
  applyLobbyPayload,
} from '../services/lobbySession';
import { LOBBY_SELECTION_LOCK_REMAINING_SEC } from '../utils/lobbySelectionLock';
import { getPlayerUserId, initTelegramWebApp } from '../api/playerIdentity';
import {
  bindAudioUnlockOnInteraction,
  unlockGameAudio,
} from '../audio/gameSounds';

/** Fixed game entry cost shown in STAKE box (always 10 Birr) */
const GAME_ENTRY_STAKE = 10;
const MAX_CARTELS = 2;
const ALL_CARTELS = Array.from({ length: 400 }, (_, i) => i + 1);

const METRIC_BOX =
  'flex min-h-[40px] flex-col items-center justify-center rounded-lg border border-white/[0.12] bg-theme-surface sm:min-h-[44px] sm:rounded-xl';

function MetricBox({ label, value, isTimer = false, urgent = false }) {
  if (isTimer) {
    return (
      <div
        className={`${METRIC_BOX} px-0.5 py-1 sm:px-1 sm:py-1.5 ${
          urgent
            ? 'border-red-500 bg-red-500/10 shadow-[0_0_10px_rgba(239,68,68,0.3)]'
            : 'border-white/[0.12]'
        }`}
      >
        <p className="text-[7px] font-medium uppercase tracking-wide text-slate-400 sm:text-[8px]">
          TIMER
        </p>
        <span
          className={`mt-0.5 text-sm font-bold tabular-nums leading-none sm:text-base ${
            urgent ? 'text-red-400' : 'text-amber-400'
          }`}
        >
          {value}
        </span>
      </div>
    );
  }

  return (
    <div className={`${METRIC_BOX} px-0.5 py-1 sm:px-1 sm:py-1.5`}>
      <p className="text-[7px] font-medium uppercase tracking-wide text-slate-400 sm:text-[8px]">
        {label}
      </p>
      <p className="mt-0.5 max-w-full truncate text-xs font-bold tabular-nums leading-none text-white sm:text-base">
        {value}
      </p>
    </div>
  );
}

const CartelButton = memo(function CartelButton({ num, status, onToggle, locked }) {
  const base =
    'flex h-[clamp(24px,6.5vw,28px)] w-full min-w-0 touch-manipulation items-center justify-center rounded-md border text-[clamp(11px,3.2vw,13px)] font-bold leading-none tabular-nums transition';

  let className = `${base} border-white/10 bg-[#151b2e] text-white hover:border-white/20 active:scale-95`;
  let disabled = Boolean(locked);

  if (status === 'mine') {
    className = `${base} border-green-400 bg-green-500 text-white shadow-[0_0_10px_rgba(34,197,94,0.55)]`;
  } else if (status === 'taken') {
    className = `${base} cursor-not-allowed border-orange-400 bg-orange-500 text-white shadow-[0_0_8px_rgba(249,115,22,0.45)] opacity-95`;
    disabled = true;
  } else if (locked) {
    className = `${base} cursor-not-allowed border-white/10 bg-[#151b2e] text-white/50`;
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onToggle(num)}
      className={className}
      aria-label={
        status === 'mine'
          ? `Cartela ${num} selected`
          : status === 'taken'
            ? `Cartela ${num} taken by another player`
            : `Cartela ${num} available`
      }
    >
      {num}
    </button>
  );
});

function CartelBoardPanel({ selectionCount, selectedCartels, isDual }) {
  return (
    <section
      className="board-static shrink-0 overflow-visible border-t border-white/[0.08] bg-[#0A0F1D] px-2 py-2 sm:px-6 sm:py-3"
      aria-label="Selected cartel boards"
    >
      {selectionCount === 0 && (
        <div className="flex items-center justify-center py-6">
          <p className="text-center text-xs font-medium text-white/35">
            Select a cartel to view board
          </p>
        </div>
      )}

      {selectionCount === 1 && (
        <div className="flex justify-center overflow-visible py-2">
          <BingoGrid cartelId={selectedCartels[0]} />
        </div>
      )}

      {isDual && (
        <div className="mx-auto grid w-full max-w-full grid-cols-2 place-items-center gap-x-[clamp(12px,5vw,40px)] gap-y-2 overflow-visible px-1 py-2 sm:max-w-[400px] sm:gap-x-10">
          {selectedCartels.map((cartelId) => (
            <div key={cartelId} className="flex justify-center">
              <BingoGrid cartelId={cartelId} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function selectionFieldsEqual(prev, snap) {
  if (!prev || !snap) return false;
  if (prev.selectionLocked !== snap.selectionLocked) return false;
  if (prev.gameInProgress !== snap.gameInProgress) return false;
  if (prev.gameId !== snap.gameId) return false;
  if (prev.selectedCartels.length !== snap.selectedCartels.length) return false;
  if (!prev.selectedCartels.every((n, i) => n === snap.selectedCartels[i])) {
    return false;
  }
  if (prev.takenCartels.size !== snap.takenCartels.size) return false;
  for (const n of prev.takenCartels) {
    if (!snap.takenCartels.has(n)) return false;
  }
  return true;
}

const CartelGridRow = memo(function CartelGridRow({
  nums,
  selectedSet,
  takenSet,
  onToggle,
  locked,
}) {
  return (
    <div className="contents">
      {nums.map((num) => {
        const status = selectedSet.has(num)
          ? 'mine'
          : takenSet.has(num)
            ? 'taken'
            : 'available';
        return (
          <CartelButton
            key={num}
            num={num}
            status={status}
            onToggle={onToggle}
            locked={locked}
          />
        );
      })}
    </div>
  );
});

export default function CardSelection() {
  const navigate = useNavigate();
  const initial = getLobbyState();
  const [lobbySelection, setLobbySelection] = useState(() => ({
    selectedCartels: initial.selectedCartels,
    takenCartels: initial.takenCartels,
    selectionLocked: initial.selectionLocked,
    gameInProgress: initial.gameInProgress,
    gameId: initial.gameId,
  }));
  const [timer, setTimer] = useState(initial.countdownSeconds ?? 0);
  const [topBanner, setTopBanner] = useState(null);
  const [mainWallet, setMainWallet] = useState(0);
  const [playWallet, setPlayWallet] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const selectedCartels = lobbySelection.selectedCartels;
  const otherTakenCartels = lobbySelection.takenCartels;
  const selectionLocked =
    lobbySelection.selectionLocked ||
    lobbySelection.gameInProgress ||
    timer <= LOBBY_SELECTION_LOCK_REMAINING_SEC;
  const gameId = lobbySelection.gameId;

  const selectedSet = useMemo(
    () => new Set(selectedCartels),
    [selectedCartels]
  );

  const cartelRows = useMemo(() => {
    const rows = [];
    for (let i = 0; i < ALL_CARTELS.length; i += 8) {
      rows.push(ALL_CARTELS.slice(i, i + 8));
    }
    return rows;
  }, []);

  const selectionCount = selectedCartels.length;
  const isDual = selectionCount === 2;
  const navigateTab = useCallback(
    (screen) => {
      if (screen === 'home') navigate('/');
      else navigate('/', { state: { tab: screen } });
    },
    [navigate]
  );

  useEffect(() => {
    return subscribeLobby((snap) => {
      setTimer(snap.countdownSeconds ?? 0);
      setLobbySelection((prev) => {
        if (selectionFieldsEqual(prev, snap)) return prev;
        return {
          selectedCartels: snap.selectedCartels,
          takenCartels: snap.takenCartels,
          selectionLocked: snap.selectionLocked,
          gameInProgress: snap.gameInProgress,
          gameId: snap.gameId,
        };
      });
    });
  }, []);

  const toggleCartel = useCallback(
    (num) => {
      if (selectionLocked) {
        return;
      }

      const result = toggleCartelSelection(num, {
        maxCartels: MAX_CARTELS,
        entryStake: GAME_ENTRY_STAKE,
        totalWalletBalance: mainWallet + playWallet,
      });

      if (!result.ok) {
        if (result.reason === 'max') {
          setTopBanner('⚠️ MAXIMUM 2 CARTELS ALLOWED');
        } else if (result.reason === 'balance') {
          setTopBanner('⚠️ INSUFFICIENT BALANCE!');
        }
        return;
      }

      setTopBanner(null);
      if (result.action === 'select') {
        void unlockGameAudio();
      }
    },
    [selectionLocked, mainWallet, playWallet]
  );

  const walletSetters = useMemo(
    () => ({ setMainWallet, setPlayWallet }),
    []
  );

  const loadGameData = useCallback(async () => {
    const userId = getPlayerUserId();
    const data = await fetchGameData(userId);
    setMainWallet(data.mainWallet);
    setPlayWallet(data.playWallet);
    applyLobbyPayload(data, { mergeCartels: false, mergeTaken: true });
  }, []);

  useEffect(() => {
    initTelegramWebApp();
    const unbindUnlock = bindAudioUnlockOnInteraction();
    const userId = getPlayerUserId();
    const socket = getSocket();
    socket.emit('wallet:register', { userId, telegramId: userId });

    const onWalletUpdate = (payload) => {
      applyWalletSnapshot(payload, walletSetters);
    };

    socket.on('wallet:update', onWalletUpdate);

    const onGameError = (payload) => {
      if (payload?.error === 'insufficient_balance') {
        setTopBanner('⚠️ INSUFFICIENT BALANCE!');
      }
    };
    socket.on('game:error', onGameError);

    return () => {
      unbindUnlock();
      socket.off('wallet:update', onWalletUpdate);
      socket.off('game:error', onGameError);
    };
  }, [walletSetters]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await loadGameData();
      const userId = getPlayerUserId();
      const socket = getSocket();
      socket.emit('game:lobby-sync', { userId, telegramId: userId });
    } finally {
      setIsRefreshing(false);
    }
  }, [loadGameData]);

  useEffect(() => {
    initTelegramWebApp();
    loadGameData();
  }, [loadGameData]);

  useEffect(() => {
    if (!topBanner) return undefined;
    const t = setTimeout(() => setTopBanner(null), 4500);
    return () => clearTimeout(t);
  }, [topBanner]);

  const timerUrgent = timer <= 10 && timer > 0;

  return (
    <div className="flex h-[100dvh] max-h-[100dvh] w-full max-w-[100vw] flex-col overflow-hidden bg-[#0A0F1D] font-sans text-white">
      <div className="shrink-0">
        <header className="flex items-center justify-between gap-2 px-2 py-2 sm:px-3">
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => navigate('/')}
              className="flex min-h-[40px] touch-manipulation items-center gap-1.5 rounded-xl border border-white/[0.12] bg-theme-elevated px-2.5 py-2 text-xs text-white sm:px-3 sm:py-1.5"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>
            {topBanner && (
              <div
                className="pointer-events-none absolute left-0 top-[calc(100%+4px)] z-30 max-w-[min(70vw,220px)] rounded-md border border-red-500/45 bg-[#3a1218]/95 px-2 py-0.5 text-[9px] font-bold leading-tight tracking-wide text-red-100 shadow-[0_4px_12px_rgba(0,0,0,0.45)] backdrop-blur-sm sm:text-[10px]"
                role="status"
                aria-live="polite"
              >
                {topBanner}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="flex min-h-[40px] touch-manipulation items-center gap-1.5 rounded-xl border border-white/[0.12] bg-theme-elevated px-2.5 py-2 text-xs text-white disabled:opacity-60 sm:px-3 sm:py-1.5"
          >
            <RefreshCw
              className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`}
            />
            Refresh
          </button>
        </header>

        <section className="grid grid-cols-4 gap-1 px-2 pb-1.5 sm:gap-1.5 sm:px-3 sm:pb-2">
          <MetricBox label="MAIN WALLET" value={mainWallet} />
          <MetricBox label="PLAY WALLET" value={playWallet} />
          <MetricBox label="STAKE" value={GAME_ENTRY_STAKE} />
          <MetricBox isTimer value={`${timer} s`} urgent={timerUrgent} />
        </section>
      </div>

      <section className="min-h-0 flex-1 overflow-hidden px-2 sm:px-3">
        <div className="cartel-scroll h-full overflow-y-auto overscroll-contain rounded-xl border border-white/[0.08] bg-[#0d1220]/50 p-1.5 sm:p-2">
          <div className="grid grid-cols-8 gap-1.5 sm:gap-2">
            {cartelRows.map((nums, rowIndex) => (
              <CartelGridRow
                key={rowIndex}
                nums={nums}
                selectedSet={selectedSet}
                takenSet={otherTakenCartels}
                onToggle={toggleCartel}
                locked={selectionLocked}
              />
            ))}
          </div>
        </div>
      </section>

      <div className="shrink-0 overflow-visible pb-[calc(3.75rem+env(safe-area-inset-bottom,0px))] sm:pb-[4rem]">
        <CartelBoardPanel
          selectionCount={selectionCount}
          selectedCartels={selectedCartels}
          isDual={isDual}
        />
      </div>

      <Navbar activeScreen="home" onNavigate={navigateTab} />
    </div>
  );
}
