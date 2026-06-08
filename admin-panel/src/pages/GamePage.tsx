import { useCallback, useEffect, useState } from 'react';
import PanelCard from '../components/PanelCard';
import NumberBoard from '../components/NumberBoard';
import { useGame } from '../context/GameContext';
import {
  fetchCardSelectionTimeSettings,
  updateCardSelectionTimeSettings,
} from '../services/api';
import type { CardSelectionTimeSettings } from '../types';

function ActionButton({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        'rounded-xl border px-4 py-2 text-sm font-bold transition',
        disabled
          ? 'cursor-not-allowed border-white/10 bg-white/5 text-slate-400 opacity-60'
          : 'border-white/10 bg-white/5 text-white hover:bg-white/10 active:scale-[0.99]',
      ].join(' ')}
    >
      {label}
    </button>
  );
}

function clampSeconds(
  value: number,
  min: number,
  max: number
): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

export default function GamePage() {
  const { game, loading, actionLoading, startGame, stopGame, drawNumber, resetGame } =
    useGame();

  const [timerSettings, setTimerSettings] =
    useState<CardSelectionTimeSettings | null>(null);
  const [secondsDraft, setSecondsDraft] = useState(1);
  const [timerLoading, setTimerLoading] = useState(true);
  const [timerSaving, setTimerSaving] = useState(false);
  const [timerError, setTimerError] = useState<string | null>(null);
  const [timerMessage, setTimerMessage] = useState<string | null>(null);

  const minSeconds = timerSettings?.minSeconds ?? 1;
  const maxSeconds = timerSettings?.maxSeconds ?? 100;

  const loadTimerSettings = useCallback(async () => {
    setTimerLoading(true);
    setTimerError(null);
    try {
      const data = await fetchCardSelectionTimeSettings();
      setTimerSettings(data);
      setSecondsDraft(
        clampSeconds(
          Math.round(data.cardSelectionTime) || 1,
          data.minSeconds,
          data.maxSeconds
        )
      );
    } catch {
      setTimerError('Could not load card selection timer.');
    } finally {
      setTimerLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTimerSettings();
  }, [loadTimerSettings]);

  const adjustSeconds = (delta: number) => {
    setSecondsDraft((prev) => clampSeconds(prev + delta, minSeconds, maxSeconds));
    setTimerMessage(null);
  };

  const onSecondsInput = (raw: string) => {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    setSecondsDraft(clampSeconds(parsed, minSeconds, maxSeconds));
    setTimerMessage(null);
  };

  const onSaveTimer = async () => {
    setTimerSaving(true);
    setTimerError(null);
    setTimerMessage(null);
    try {
      const saved = await updateCardSelectionTimeSettings(secondsDraft);
      setTimerSettings(saved);
      setSecondsDraft(
        clampSeconds(
          Math.round(saved.cardSelectionTime),
          saved.minSeconds,
          saved.maxSeconds
        )
      );
      setTimerMessage(
        `Saved — ${saved.cardSelectionTime} seconds. Applies on the next countdown cycle.`
      );
    } catch {
      setTimerError('Failed to save card selection timer.');
    } finally {
      setTimerSaving(false);
    }
  };

  const called = game?.calledNumbers ?? [];
  const last20 = called.slice(-20);
  const newest = game?.latestBall ?? last20.at(-1) ?? null;

  const status = game?.status ?? 'STOPPED';
  const running = status === 'RUNNING';
  const finished = status === 'FINISHED';

  const disableAll = loading || Boolean(actionLoading);
  const disableTimer = timerLoading || timerSaving;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <PanelCard
        title="Game Control Panel"
        subtitle="Start / Stop / Draw / Reset (real-time)"
        right={
          <span className="text-xs font-bold text-indigo-300">
            {status}
          </span>
        }
      >
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <ActionButton
              label={disableAll ? 'Starting…' : 'Start Game'}
              onClick={() => startGame()}
              disabled={disableAll || running}
            />
            <ActionButton
              label="Stop Game"
              onClick={() => stopGame()}
              disabled={disableAll || !running}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <ActionButton
              label="Draw Number"
              onClick={() => drawNumber()}
              disabled={disableAll || !running || finished}
            />
            <ActionButton
              label="Reset Game"
              onClick={() => resetGame()}
              disabled={disableAll || !game?.gameId}
            />
          </div>

          <div className="rounded-xl border border-white/10 bg-white/5 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Latest ball
            </p>
            <p className="mt-1 text-3xl font-extrabold tabular-nums text-white">
              {newest ?? '—'}
            </p>

            <p className="mt-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Called count
            </p>
            <p className="mt-1 text-sm font-extrabold text-indigo-200">
              {called.length} / 75
            </p>
          </div>
        </div>
      </PanelCard>

      <PanelCard
        title="Card Selection Timer"
        subtitle="Lobby countdown duration (1–100 seconds)"
      >
        <div className="space-y-4">
          <p className="text-xs text-slate-400">
            Controls how long players have to pick cartelas before each countdown
            cycle restarts. Card assignment logic is unchanged.
          </p>

          {timerLoading ? (
            <p className="text-sm text-slate-400">Loading timer settings…</p>
          ) : (
            <>
              <div className="flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => adjustSeconds(-1)}
                  disabled={disableTimer || secondsDraft <= minSeconds}
                  className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-lg font-bold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label="Decrease timer by one second"
                >
                  −
                </button>

                <div className="flex min-w-[7rem] flex-col items-center">
                  <input
                    type="number"
                    min={minSeconds}
                    max={maxSeconds}
                    step={1}
                    value={secondsDraft}
                    onChange={(e) => onSecondsInput(e.target.value)}
                    disabled={disableTimer}
                    className="w-full rounded-xl border border-white/15 bg-[#0f172a] px-3 py-2 text-center text-2xl font-extrabold tabular-nums text-white outline-none focus:border-indigo-400/50 disabled:opacity-60"
                    aria-label="Card selection time in seconds"
                  />
                  <span className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    seconds
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => adjustSeconds(1)}
                  disabled={disableTimer || secondsDraft >= maxSeconds}
                  className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-lg font-bold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label="Increase timer by one second"
                >
                  +
                </button>
              </div>

              <p className="text-center text-xs text-slate-400">
                Range: {minSeconds}–{maxSeconds} seconds
                {timerSettings
                  ? ` • Current server value: ${timerSettings.cardSelectionTime} seconds`
                  : null}
              </p>

              <ActionButton
                label={timerSaving ? 'Saving…' : 'Save'}
                onClick={onSaveTimer}
                disabled={disableTimer}
              />
            </>
          )}

          {timerError ? (
            <p className="text-xs font-semibold text-rose-300">{timerError}</p>
          ) : null}
          {timerMessage ? (
            <p className="text-xs font-semibold text-emerald-300">{timerMessage}</p>
          ) : null}
        </div>
      </PanelCard>

      <PanelCard title="Live Bingo Board" subtitle="Last 20 drawn numbers">
        <NumberBoard numbers={called} newestNumber={newest} limit={20} />
      </PanelCard>

      <PanelCard title="Operational tips" subtitle="How the game loop works">
        <ul className="space-y-2 text-sm text-slate-300">
          <li className="rounded-lg border border-white/10 bg-white/5 p-3">
            Start game to begin the ball-calling loop (server-side interval).
          </li>
          <li className="rounded-lg border border-white/10 bg-white/5 p-3">
            Draw number triggers one ball only (when running).
          </li>
          <li className="rounded-lg border border-white/10 bg-white/5 p-3">
            Stop game pauses the draw timer; Reset clears round state and restarts lobby countdown.
          </li>
        </ul>
      </PanelCard>
    </div>
  );
}
