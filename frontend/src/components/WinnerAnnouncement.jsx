import { useEffect, useRef, useState } from 'react';
import { Crown, Star, Trophy } from 'lucide-react';
import { generateBingoCard } from '../utils/bingoCard';
import { getCartelMarkedKeys, getWinningLineCellKeys } from '../utils/bingoWin';

const DISPLAY_SECONDS = 6;
const MAX_VISIBLE_WINNERS = 3;
const MAX_SIDE_BY_SIDE_CARDS = 2;

function orderWinners(winners, primaryCartelId) {
  const list = Array.isArray(winners) ? [...winners] : [];
  const primaryIndex = list.findIndex(
    (winner) => Number(winner?.cartelId) === Number(primaryCartelId)
  );
  if (primaryIndex > 0) {
    const [primaryWinner] = list.splice(primaryIndex, 1);
    list.unshift(primaryWinner);
  }
  return list;
}

function formatWinnerCard(winner) {
  const name = String(winner?.playerName || 'Player').trim();
  const cartelId = winner?.cartelId;
  const idLabel =
    cartelId != null && String(cartelId).length > 0
      ? `ID #${cartelId}`
      : '';
  const prize = Math.max(0, Math.floor(Number(winner?.prize) || 0));
  return { name, idLabel, prize };
}

function winnerCountLabel(count) {
  if (count <= 1) return '1 PLAYER WON!';
  return `${count} PLAYERS WON!`;
}

const COLUMN_HEADERS = [
  { letter: 'B', color: 'bg-sky-400' },
  { letter: 'I', color: 'bg-indigo-500' },
  { letter: 'N', color: 'bg-fuchsia-500' },
  { letter: 'G', color: 'bg-emerald-500' },
  { letter: 'O', color: 'bg-orange-500' },
];

const CELL =
  'flex h-[clamp(38px,11.5vw,50px)] w-[clamp(38px,11.5vw,50px)] items-center justify-center rounded-md text-[clamp(11px,3.2vw,14px)] font-bold tabular-nums leading-none';

function PartyPopper({ flip, className = '' }) {
  return (
    <span
      className={`winner-popper text-[1.6rem] leading-none sm:text-[1.75rem] ${flip ? 'scale-x-[-1]' : ''} ${className}`}
      aria-hidden
    >
      🎉
    </span>
  );
}

function WinnerCartelGrid({
  cartelId,
  calledNumbers,
  manualMarks,
  automatic,
}) {
  const { grid } = generateBingoCard(cartelId);
  const called =
    calledNumbers instanceof Set ? calledNumbers : new Set(calledNumbers);
  const markedKeys = getCartelMarkedKeys(
    cartelId,
    calledNumbers,
    manualMarks,
    automatic
  );
  const winLine = getWinningLineCellKeys(markedKeys);

  const cellStyle = (row, col, cell) => {
    const key = `${row}-${col}`;
    const onWinLine = winLine.has(key);
    const isFree = row === 2 && col === 2;
    const isCalled = cell != null && called.has(cell);
    const isDaubed =
      markedKeys.has(key) || (automatic && isCalled) || isFree;

    if (isFree) {
      return `${CELL} bg-emerald-500 text-white shadow-[0_1px_4px_rgba(16,185,129,0.35)]`;
    }
    if (onWinLine) {
      return `${CELL} bg-emerald-500 text-white shadow-[0_0_10px_rgba(16,185,129,0.45)] winner-win-cell`;
    }
    if (isDaubed && isCalled) {
      return `${CELL} bg-orange-500 text-white shadow-[0_1px_4px_rgba(249,115,22,0.35)]`;
    }
    return `${CELL} bg-white text-[#0B0D17] shadow-[0_1px_2px_rgba(0,0,0,0.12)]`;
  };

  return (
    <div className="winner-card-grid w-full rounded-2xl border border-white/10 bg-[#1a1d28] p-3.5 shadow-[0_0_28px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.06)] sm:p-4">
      <div className="mx-auto grid w-fit max-w-full grid-cols-5 gap-1.5 sm:gap-2">
        {COLUMN_HEADERS.map(({ letter, color }) => (
          <div
            key={letter}
            className={`flex h-[clamp(38px,11.5vw,50px)] w-[clamp(38px,11.5vw,50px)] items-center justify-center rounded-md text-[clamp(11px,3.2vw,14px)] font-extrabold text-white ${color}`}
          >
            {letter}
          </div>
        ))}

        {grid.map((row, rowIndex) =>
          row.map((cell, colIndex) => {
            const isFree = rowIndex === 2 && colIndex === 2;

            return (
              <div
                key={`${rowIndex}-${colIndex}`}
                className={cellStyle(rowIndex, colIndex, cell)}
              >
                {isFree ? (
                  <Star className="h-4 w-4 fill-white text-white" />
                ) : (
                  cell
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function ReturnCountdown({ durationSec, onComplete }) {
  const [secondsLeft, setSecondsLeft] = useState(durationSec);
  const completedRef = useRef(false);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    completedRef.current = false;
    setSecondsLeft(durationSec);

    const started = performance.now();
    const durationMs = durationSec * 1000;

    const finishTimer = window.setTimeout(() => {
      if (completedRef.current) return;
      completedRef.current = true;
      setSecondsLeft(0);
      onCompleteRef.current?.();
    }, durationMs);

    const syncCountdown = () => {
      const elapsed = performance.now() - started;
      const remaining = Math.max(0, Math.ceil((durationMs - elapsed) / 1000));
      setSecondsLeft((prev) => (prev === remaining ? prev : remaining));
    };

    syncCountdown();
    const countdownTimer = window.setInterval(syncCountdown, 250);

    return () => {
      window.clearTimeout(finishTimer);
      window.clearInterval(countdownTimer);
    };
  }, [durationSec]);

  return (
    <div className="relative z-10 mx-auto mt-5 w-[50%] min-w-[9rem] max-w-[10.5rem]">
      <p className="text-center text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-400">
        STARTING IN {secondsLeft}S
      </p>
      <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-[#2a2d38]">
        <div
          className="winner-progress-fill h-full w-full rounded-full bg-orange-500"
          style={{ animationDuration: `${durationSec}s` }}
        />
      </div>
    </div>
  );
}

function WinnerPlayerCards({ winners, hiddenCount }) {
  const cardWinners = winners.slice(0, MAX_SIDE_BY_SIDE_CARDS);
  const isSingle = cardWinners.length === 1;

  return (
    <div className="relative z-10 mt-3 w-full">
      <div
        className={`grid w-full gap-2 ${
          isSingle ? 'mx-auto max-w-[48%] grid-cols-1' : 'grid-cols-2'
        }`}
      >
        {cardWinners.map((winner, index) => {
          const { name, idLabel, prize } = formatWinnerCard(winner);
          return (
            <div
              key={`${winner?.cartelId ?? winner?.userId ?? index}-${name}`}
              className="rounded-xl bg-[#252833] px-2 py-2.5 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
              title={prize > 0 ? `${name} — ${prize} Birr` : name}
            >
              <p className="truncate text-sm font-bold text-white">{name}</p>
              {idLabel ? (
                <p className="mt-0.5 text-[11px] font-semibold text-amber-400">
                  {idLabel}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
      {hiddenCount > 0 ? (
        <p className="mt-2 text-center text-xs font-bold text-amber-400">
          +{hiddenCount} More
        </p>
      ) : null}
    </div>
  );
}

export default function WinnerAnnouncement({
  winners,
  primaryCartelId,
  calledNumbers,
  manualMarksByCartel,
  automatic,
  onComplete,
}) {
  const orderedWinners = orderWinners(winners, primaryCartelId);
  const visibleWinners = orderedWinners.slice(0, MAX_VISIBLE_WINNERS);
  const hiddenCount = Math.max(0, orderedWinners.length - visibleWinners.length);
  const totalWinners = orderedWinners.length;

  return (
    <div className="winner-overlay fixed inset-0 z-50 flex items-center justify-center overflow-y-auto px-3 py-5 sm:px-4 sm:py-6">
      <style>{`
        @keyframes winnerOverlayIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes winnerPanelIn {
          0% { opacity: 0; transform: scale(0.92) translateY(16px); }
          100% { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes winnerHeaderGlow {
          0%, 100% { opacity: 0.65; }
          50% { opacity: 1; }
        }
        @keyframes winnerPopperBounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-3px); }
        }
        @keyframes winnerPopperBounceFlip {
          0%, 100% { transform: scaleX(-1) translateY(0); }
          50% { transform: scaleX(-1) translateY(-3px); }
        }
        @keyframes winnerWinCellPulse {
          0%, 100% { box-shadow: 0 0 10px rgba(16,185,129,0.45); }
          50% { box-shadow: 0 0 14px rgba(16,185,129,0.65); }
        }
        @keyframes winnerCardGridIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes winnerProgressFill {
          from { transform: scaleX(0); }
          to { transform: scaleX(1); }
        }
        .winner-overlay {
          animation: winnerOverlayIn 0.3s ease-out forwards;
          background: transparent;
          pointer-events: none;
        }
        .winner-panel {
          animation: winnerPanelIn 0.45s cubic-bezier(0.34, 1.2, 0.64, 1) forwards;
        }
        .winner-header-glow {
          animation: winnerHeaderGlow 2.4s ease-in-out infinite;
        }
        .winner-popper {
          animation: winnerPopperBounce 1.1s ease-in-out infinite;
        }
        .winner-popper-flip {
          animation: winnerPopperBounceFlip 1.1s ease-in-out infinite;
        }
        .winner-win-cell {
          animation: winnerWinCellPulse 1.6s ease-in-out infinite;
        }
        .winner-card-grid {
          animation: winnerCardGridIn 0.5s ease-out 0.15s both;
        }
        .winner-progress-fill {
          transform: scaleX(0);
          transform-origin: left center;
          will-change: transform;
          animation-name: winnerProgressFill;
          animation-timing-function: linear;
          animation-fill-mode: forwards;
        }
      `}</style>

      <div className="winner-panel pointer-events-auto relative my-auto flex w-full max-w-[min(100%,380px)] flex-col items-center overflow-hidden rounded-[2rem] bg-[#1c1f2b] px-4 py-5 shadow-[0_24px_48px_rgba(0,0,0,0.55)] sm:px-5 sm:py-6">
        <div
          className="winner-header-glow pointer-events-none absolute inset-x-0 top-0 h-36 bg-[radial-gradient(ellipse_at_center,rgba(245,158,11,0.2)_0%,transparent_68%)]"
          aria-hidden
        />

        <div className="relative z-10 flex h-11 w-11 items-center justify-center">
          <Crown
            className="h-10 w-10 text-amber-400 drop-shadow-[0_2px_8px_rgba(251,191,36,0.5)]"
            strokeWidth={1.25}
            fill="currentColor"
          />
        </div>

        <div className="relative z-10 mt-2 flex items-center justify-center gap-2">
          <PartyPopper className="winner-popper" />
          <h1 className="text-[2.1rem] font-black uppercase leading-none tracking-tight text-white sm:text-[2.35rem]">
            BINGO!
          </h1>
          <PartyPopper flip className="winner-popper-flip" />
        </div>

        <div className="relative z-10 mt-2 flex items-center justify-center gap-1.5">
          <Trophy className="h-3.5 w-3.5 text-amber-400" aria-hidden />
          <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-amber-400">
            {winnerCountLabel(totalWinners)}
          </span>
        </div>

        <WinnerPlayerCards winners={visibleWinners} hiddenCount={hiddenCount} />

        <div className="relative z-10 mt-4 flex w-full flex-col items-center">
          <p className="mb-2.5 text-center text-[9px] font-bold uppercase tracking-[0.22em] text-amber-400">
            WINNING CARTEL VIEW
          </p>
          <div className="w-full">
            <WinnerCartelGrid
            cartelId={primaryCartelId}
            calledNumbers={calledNumbers}
            manualMarks={manualMarksByCartel[primaryCartelId]}
            automatic={automatic}
            />
          </div>
        </div>

        <ReturnCountdown durationSec={DISPLAY_SECONDS} onComplete={onComplete} />
      </div>
    </div>
  );
}
