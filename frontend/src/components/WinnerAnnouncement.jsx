import { useEffect, useRef, useState } from 'react';
import { Crown, Sparkles, Star } from 'lucide-react';
import { generateBingoCard } from '../utils/bingoCard';
import { getCartelMarkedKeys, getWinningLineCellKeys } from '../utils/bingoWin';

const DISPLAY_SECONDS = 6;
const MAX_VISIBLE_WINNERS = 3;

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

function formatWinnerLine(winner) {
  const name = String(winner?.playerName || 'Player').trim();
  const prize = Math.max(0, Math.floor(Number(winner?.prize) || 0));
  return { name, prize };
}

/** B-I-N-G-O headers — match winner screen reference */
const COLUMN_HEADERS = [
  { letter: 'B', color: 'bg-sky-400 shadow-[0_2px_8px_rgba(56,189,248,0.45)]' },
  { letter: 'I', color: 'bg-indigo-500 shadow-[0_2px_8px_rgba(99,102,241,0.45)]' },
  { letter: 'N', color: 'bg-fuchsia-500 shadow-[0_2px_8px_rgba(217,70,239,0.45)]' },
  { letter: 'G', color: 'bg-emerald-500 shadow-[0_2px_8px_rgba(16,185,129,0.45)]' },
  { letter: 'O', color: 'bg-orange-500 shadow-[0_2px_8px_rgba(249,115,22,0.45)]' },
];

const CELL =
  'flex h-[clamp(32px,9vw,44px)] w-[clamp(32px,9vw,44px)] items-center justify-center rounded-lg border text-[clamp(11px,3vw,14px)] font-bold tabular-nums leading-none transition-transform duration-300';

/** Lightweight CSS confetti — no extra dependencies */
const CONFETTI_PIECES = [
  { left: '8%', delay: '0s', color: '#fbbf24', dur: '2.8s' },
  { left: '18%', delay: '0.15s', color: '#f472b6', dur: '3.1s' },
  { left: '28%', delay: '0.05s', color: '#34d399', dur: '2.6s' },
  { left: '38%', delay: '0.25s', color: '#60a5fa', dur: '3.3s' },
  { left: '48%', delay: '0.1s', color: '#fb923c', dur: '2.9s' },
  { left: '58%', delay: '0.2s', color: '#a78bfa', dur: '3s' },
  { left: '68%', delay: '0.08s', color: '#facc15', dur: '2.7s' },
  { left: '78%', delay: '0.18s', color: '#4ade80', dur: '3.2s' },
  { left: '88%', delay: '0.12s', color: '#f87171', dur: '2.85s' },
  { left: '92%', delay: '0.22s', color: '#38bdf8', dur: '3.15s' },
];

function CelebrationConfetti() {
  return (
    <div className="winner-confetti pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {CONFETTI_PIECES.map((piece, i) => (
        <span
          key={i}
          className="winner-confetti-piece absolute top-0 h-2 w-1.5 rounded-sm opacity-90"
          style={{
            left: piece.left,
            backgroundColor: piece.color,
            animationDelay: piece.delay,
            animationDuration: piece.dur,
          }}
        />
      ))}
    </div>
  );
}

function PartyPopper({ flip, className = '' }) {
  return (
    <span
      className={`winner-popper text-3xl leading-none sm:text-4xl ${flip ? 'scale-x-[-1]' : ''} ${className}`}
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

    if (onWinLine) {
      return `${CELL} border-emerald-400 bg-gradient-to-br from-green-400 to-emerald-600 text-white shadow-[0_0_12px_rgba(34,197,94,0.5)] winner-win-cell`;
    }
    if (isDaubed && isCalled && !isFree) {
      return `${CELL} border-amber-300 bg-gradient-to-br from-orange-400 to-amber-500 text-white shadow-[0_2px_6px_rgba(251,146,60,0.35)]`;
    }
    return `${CELL} border-slate-200/90 bg-white text-[#0A0F1D] shadow-sm`;
  };

  return (
    <div className="winner-card-grid w-full max-w-full overflow-x-auto rounded-2xl border border-white/10 bg-gradient-to-b from-[#2a3050] to-[#1e2438] p-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_8px_24px_rgba(0,0,0,0.35)] sm:p-3.5">
      <div className="mx-auto grid w-fit max-w-full grid-cols-5 gap-[clamp(5px,1.4vw,8px)]">
        {COLUMN_HEADERS.map(({ letter, color }) => (
          <div
            key={letter}
            className={`flex h-[clamp(32px,9vw,44px)] w-[clamp(32px,9vw,44px)] items-center justify-center rounded-lg text-[clamp(11px,3vw,14px)] font-extrabold text-white ${color}`}
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
                  <Star className="h-4 w-4 fill-amber-300 text-amber-300" />
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
    <>
      <p className="relative z-10 mt-7 text-[11px] font-semibold uppercase tracking-[0.22em] text-white/50">
        Returning to lobby in{' '}
        <span className="tabular-nums text-amber-300">{secondsLeft}s</span>
      </p>
      <div className="relative z-10 mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className="winner-progress-fill winner-progress-glow h-full w-full rounded-full bg-gradient-to-r from-amber-400 via-orange-400 to-amber-500"
          style={{ animationDuration: `${durationSec}s` }}
        />
      </div>
    </>
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

  return (
    <div className="winner-overlay fixed inset-0 z-50 flex items-center justify-center overflow-y-auto px-3 py-4 sm:px-4 sm:py-6">
      <style>{`
        @keyframes winnerOverlayIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes winnerPanelIn {
          0% { opacity: 0; transform: scale(0.88) translateY(24px); }
          60% { transform: scale(1.02) translateY(-4px); }
          100% { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes winnerGlowPulse {
          0%, 100% { opacity: 0.45; transform: scale(1); }
          50% { opacity: 0.85; transform: scale(1.08); }
        }
        @keyframes winnerTitleShine {
          0%, 100% { text-shadow: 0 0 20px rgba(251,191,36,0.6), 0 0 40px rgba(251,191,36,0.25); }
          50% { text-shadow: 0 0 32px rgba(251,191,36,0.95), 0 0 60px rgba(251,146,60,0.45); }
        }
        @keyframes winnerCrownFloat {
          0%, 100% { transform: translateY(0) rotate(-3deg); }
          50% { transform: translateY(-6px) rotate(3deg); }
        }
        @keyframes winnerPopperBounce {
          0%, 100% { transform: translateY(0) scale(1); }
          50% { transform: translateY(-4px) scale(1.08); }
        }
        @keyframes winnerPopperBounceFlip {
          0%, 100% { transform: scaleX(-1) translateY(0) scale(1); }
          50% { transform: scaleX(-1) translateY(-4px) scale(1.08); }
        }
        @keyframes winnerConfettiFall {
          0% { transform: translateY(-10px) rotate(0deg); opacity: 1; }
          100% { transform: translateY(110vh) rotate(720deg); opacity: 0; }
        }
        @keyframes winnerWinCellPulse {
          0%, 100% { box-shadow: 0 0 12px rgba(34,197,94,0.5); }
          50% { box-shadow: 0 0 18px rgba(34,197,94,0.75); }
        }
        @keyframes winnerCardGridIn {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .winner-overlay {
          animation: winnerOverlayIn 0.35s ease-out forwards;
          background: radial-gradient(ellipse 120% 80% at 50% 20%, rgba(88,28,135,0.35) 0%, rgba(10,15,29,0.97) 55%, #0A0F1D 100%);
          backdrop-filter: blur(6px);
        }
        .winner-panel {
          animation: winnerPanelIn 0.55s cubic-bezier(0.34, 1.4, 0.64, 1) forwards;
        }
        .winner-glow-ring {
          animation: winnerGlowPulse 2.2s ease-in-out infinite;
        }
        .winner-title {
          animation: winnerTitleShine 1.8s ease-in-out infinite;
        }
        .winner-crown {
          animation: winnerCrownFloat 2.4s ease-in-out infinite;
        }
        .winner-popper {
          animation: winnerPopperBounce 1.2s ease-in-out infinite;
        }
        .winner-popper-flip {
          animation: winnerPopperBounceFlip 1.2s ease-in-out infinite;
        }
        .winner-confetti-piece {
          animation-name: winnerConfettiFall;
          animation-timing-function: linear;
          animation-iteration-count: infinite;
        }
        .winner-win-cell {
          animation: winnerWinCellPulse 1.5s ease-in-out infinite;
        }
        .winner-card-grid {
          animation: winnerCardGridIn 0.6s ease-out 0.25s both;
        }
        @keyframes winnerProgressFill {
          from { transform: scaleX(0); }
          to { transform: scaleX(1); }
        }
        .winner-progress-fill {
          transform: scaleX(0);
          transform-origin: left center;
          will-change: transform;
          animation-name: winnerProgressFill;
          animation-timing-function: linear;
          animation-fill-mode: forwards;
        }
        .winner-progress-glow {
          box-shadow: 0 0 12px rgba(251,146,60,0.55);
        }
      `}</style>

      <CelebrationConfetti />

      <div className="winner-panel relative my-auto flex w-full max-w-[min(100%,380px)] flex-col items-center overflow-hidden rounded-[1.75rem] border border-amber-400/25 bg-gradient-to-b from-[#252550] via-[#1c1c38] to-[#141428] px-5 py-7 shadow-[0_0_60px_rgba(251,191,36,0.15),0_20px_50px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.12)] sm:px-6 sm:py-8">
        {/* Ambient glow behind crown */}
        <div
          className="winner-glow-ring pointer-events-none absolute left-1/2 top-8 h-28 w-28 -translate-x-1/2 rounded-full bg-amber-400/30 blur-2xl"
          aria-hidden
        />

        <div className="winner-crown relative z-10 flex h-14 w-14 items-center justify-center rounded-full border border-amber-300/40 bg-gradient-to-br from-amber-400/30 to-amber-600/20 shadow-[0_0_24px_rgba(251,191,36,0.4)]">
          <Crown
            className="h-8 w-8 text-amber-300 drop-shadow-[0_2px_8px_rgba(251,191,36,0.6)]"
            strokeWidth={1.25}
            fill="currentColor"
          />
        </div>

        <div className="relative z-10 mt-4 flex items-center justify-center gap-3 sm:gap-4">
          <PartyPopper className="winner-popper" />
          <h1 className="winner-title bg-gradient-to-b from-amber-200 via-amber-300 to-orange-400 bg-clip-text text-3xl font-black tracking-tight text-transparent sm:text-4xl">
            BINGO!
          </h1>
          <PartyPopper flip className="winner-popper-flip" />
        </div>

        <div className="relative z-10 mt-1 flex items-center gap-1.5 text-amber-200/80">
          <Sparkles className="h-3.5 w-3.5" aria-hidden />
          <span className="text-[10px] font-semibold uppercase tracking-[0.25em]">
            Winner
          </span>
          <Sparkles className="h-3.5 w-3.5" aria-hidden />
        </div>

        <div className="relative z-10 mt-3 w-full max-w-[300px] space-y-1 px-1">
          {visibleWinners.map((winner, index) => {
            const { name, prize } = formatWinnerLine(winner);
            return (
              <p
                key={`${winner?.cartelId ?? winner?.userId ?? index}-${name}`}
                className="truncate text-center text-[13px] font-semibold leading-snug text-white sm:text-sm"
                title={`${name} — ${prize} Birr`}
              >
                <span className="text-white/95">{name}</span>
                <span className="text-white/45"> — </span>
                <span className="tabular-nums text-amber-300">{prize} Birr</span>
              </p>
            );
          })}
          {hiddenCount > 0 ? (
            <p className="pt-0.5 text-center text-xs font-bold tracking-wide text-amber-200/85">
              +{hiddenCount} More
            </p>
          ) : null}
        </div>

        <div className="relative z-10 mt-5 w-full">
          <WinnerCartelGrid
            cartelId={primaryCartelId}
            calledNumbers={calledNumbers}
            manualMarks={manualMarksByCartel[primaryCartelId]}
            automatic={automatic}
          />
        </div>

        <ReturnCountdown durationSec={DISPLAY_SECONDS} onComplete={onComplete} />
      </div>
    </div>
  );
}
