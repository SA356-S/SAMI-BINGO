import { useEffect, useMemo, useState } from 'react';
import PanelCard from '../components/PanelCard';
import {
  fetchRobotsSnapshot,
  fetchRobotAdvantageSettings,
  createRobot,
  setRobotEnabled,
  updateRobotConfig,
  updateRobotAdvantageSettings,
  topupRobotBank,
  getApiErrorMessage,
} from '../services/api';
import {
  subscribeRobotActivity,
  subscribeRobotsSnapshot,
} from '../services/socket';
import type {
  RobotActivityEvent,
  RobotAdvantageSettings,
  RobotsSnapshotResponse,
  RobotProfileRow,
} from '../types';

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

function RobotAvatar({ seed, name }: { seed: string; name: string }) {
  const letter = (name || 'R').trim().charAt(0).toUpperCase();
  const n = Number(seed) || 0;
  const hue = n % 360;
  const bg = `hsla(${hue}, 90%, 60%, 0.22)`;
  const border = `hsla(${hue}, 90%, 70%, 0.35)`;
  const text = `hsla(${hue}, 90%, 75%, 0.95)`;

  return (
    <div
      className="flex h-9 w-9 items-center justify-center rounded-lg border"
      style={{ background: bg, borderColor: border, color: text }}
      aria-hidden
    >
      <span className="text-sm font-extrabold">{letter}</span>
    </div>
  );
}

function formatActivity(e: RobotActivityEvent) {
  const at = e.at ? new Date(e.at) : null;
  const time = at ? at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  const type = String(e.type || '');

  if (type === 'join') {
    return `${time} • ${e.robotId ?? 'robot'} joined (${(e.cartelIds || []).length} cartelas)`;
  }
  if (type === 'leave') {
    return `${time} • ${e.robotId ?? 'robot'} left`;
  }
  if (type === 'disable_leave') {
    return `${time} • ${e.robotId ?? 'robot'} left (disabled)`;
  }
  if (type === 'robot_bingo_claim') {
    return `${time} • ${e.robotId ?? 'robot'} claimed bingo (cartel ${e.cartelId ?? '—'})`;
  }
  if (type === 'round_started') {
    return `${time} • round ${e.roundId ?? ''} started`;
  }
  if (type === 'round_resolved') {
    return `${time} • round ${e.roundId ?? ''} resolved (winner: ${e.winnerRobotId ?? 'none'})`;
  }

  return `${time} • ${type} • ${e.robotId ?? ''}`;
}

export default function RobotsPage() {
  const [snapshot, setSnapshot] = useState<RobotsSnapshotResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [activity, setActivity] = useState<RobotActivityEvent[]>([]);

  const [bankTopup, setBankTopup] = useState(5000);
  const [advantage, setAdvantage] = useState<RobotAdvantageSettings | null>(null);
  const [advantageDraft, setAdvantageDraft] = useState(0);
  const [newRobotName, setNewRobotName] = useState('');
  const [createError, setCreateError] = useState('');

  const draftInitial = useMemo(() => snapshot?.config ?? null, [snapshot]);
  const [configDraft, setConfigDraft] = useState(draftInitial);

  useEffect(() => {
    setConfigDraft(snapshot?.config ?? null);
  }, [snapshot?.config]);

  const refresh = async () => {
    setLoading(true);
    try {
      const [s, adv] = await Promise.all([
        fetchRobotsSnapshot(),
        fetchRobotAdvantageSettings(),
      ]);
      setSnapshot(s);
      setAdvantage(adv);
      setAdvantageDraft(adv.robotAdvantageLevel);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    const unsubActivity = subscribeRobotActivity((e) => {
      setActivity((prev) => [e, ...prev].slice(0, 30));
    });
    const unsubSnapshot = subscribeRobotsSnapshot((s) => {
      setSnapshot(s);
    });

    return () => {
      unsubActivity();
      unsubSnapshot();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const robots = snapshot?.robots ?? [];
  const summary = snapshot?.summary;

  const netPnl = summary?.netPnl ?? 0;
  const pnlAbs = Math.max(1, Math.abs(netPnl));
  const pnlPct = Math.min(100, (Math.abs(netPnl) / pnlAbs) * 100);
  const pnlDir = netPnl >= 0 ? 'bg-emerald-500/30' : 'bg-rose-500/30';

  const onCreateRobot = async () => {
    const name = newRobotName.trim();
    if (!name || actionLoading) return;
    setCreateError('');
    setActionLoading(true);
    try {
      const result = await createRobot(name);
      if (!result?.ok) {
        setCreateError(
          result?.message ||
            (result?.error === 'name_duplicate'
              ? 'A robot with this name already exists'
              : result?.error === 'name_required'
                ? 'Robot name is required'
                : result?.error || 'Failed to create robot')
        );
        return;
      }
      setNewRobotName('');
      await refresh();
    } catch (err) {
      setCreateError(getApiErrorMessage(err, 'Failed to create robot'));
    } finally {
      setActionLoading(false);
    }
  };

  const onToggleRobot = async (robot: RobotProfileRow, enabled: boolean) => {
    if (actionLoading) return;
    setActionLoading(true);
    try {
      await setRobotEnabled(robot.robotId, enabled);
      await refresh();
    } finally {
      setActionLoading(false);
    }
  };

  const onSaveConfig = async () => {
    if (!configDraft || actionLoading) return;
    setActionLoading(true);
    try {
      await updateRobotConfig(configDraft);
      await refresh();
    } finally {
      setActionLoading(false);
    }
  };

  const onTopupBank = async () => {
    if (actionLoading) return;
    setActionLoading(true);
    try {
      await topupRobotBank(bankTopup);
      await refresh();
    } finally {
      setActionLoading(false);
    }
  };

  const advantagePreview = useMemo(() => {
    if (advantage && advantage.robotAdvantageLevel === advantageDraft) {
      return advantage;
    }

    const level = advantageDraft;
    const anchors = [
      { level: 0, target: null as number | null },
      { level: 20, target: 20 },
      { level: 40, target: 15 },
      { level: 60, min: 9, max: 13 },
      { level: 80, min: 6, max: 9 },
      { level: 100, target: 5 },
    ];

    let typical: number | null = null;
    let min: number | null = null;
    let max: number | null = null;

    for (let i = anchors.length - 1; i >= 0; i -= 1) {
      if (level >= anchors[i].level) {
        if ('min' in anchors[i] && 'max' in anchors[i]) {
          min = anchors[i].min ?? null;
          max = anchors[i].max ?? null;
          typical = min != null && max != null ? Math.round((min + max) / 2) : null;
        } else {
          typical = anchors[i].target ?? null;
          min = typical;
          max = typical;
        }
        break;
      }
    }

    const effectLabel =
      level <= 0
        ? ('FAIR' as const)
        : level <= 25
          ? ('LOW' as const)
          : level <= 60
            ? ('MEDIUM' as const)
            : ('HIGH' as const);

    return {
      robotAdvantageLevel: level,
      targetWinBallCount: typical,
      targetWinBallCountMin: min,
      targetWinBallCountMax: max,
      effectLabel,
    };
  }, [advantage, advantageDraft]);

  const onSaveAdvantage = async () => {
    if (actionLoading) return;
    setActionLoading(true);
    try {
      const updated = await updateRobotAdvantageSettings(advantageDraft);
      setAdvantage(updated);
      setAdvantageDraft(updated.robotAdvantageLevel);
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <PanelCard
        title="Robot System"
        subtitle="Configure and watch fair server-controlled activity"
        right={
          <span className="text-xs font-bold text-indigo-300">
            {snapshot ? `${snapshot.summary.activeRobots}/${snapshot.summary.totalRobots} active` : '—'}
          </span>
        }
      >
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-white/10 bg-white/5 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Bank balance
            </p>
            <p className="mt-1 text-2xl font-extrabold tabular-nums text-white">
              {snapshot?.config.bankBalance ?? 0}
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Net PnL (robots)
            </p>
            <p className="mt-1 text-2xl font-extrabold tabular-nums text-white">
              {netPnl}
            </p>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            PnL bar
          </p>
          <div className="mt-2 h-3 w-full overflow-hidden rounded-full bg-white/5">
            <div
              className={[
                'h-full w-full rounded-full',
                pnlDir,
              ].join(' ')}
              style={{ width: `${pnlPct}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-slate-300">
            Games: {summary?.gamesPlayed ?? 0} • Wins: {summary?.totalWins ?? 0} • Active games:{' '}
            {summary?.activeGames ?? 0}
          </p>
        </div>
      </PanelCard>

      <PanelCard
        title="Create Robot"
        subtitle="New robots start OFF — turn ON to join games as a player"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex-1 rounded-xl border border-white/10 bg-white/5 p-3">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Name
            </span>
            <input
              className="mt-2 w-full bg-transparent text-sm font-bold text-white outline-none"
              type="text"
              value={newRobotName}
              placeholder="e.g. Player Bot 1"
              maxLength={64}
              onChange={(e) => setNewRobotName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onCreateRobot();
              }}
            />
          </label>
          <ActionButton
            label={actionLoading ? 'Creating…' : 'Create Robot'}
            onClick={onCreateRobot}
            disabled={actionLoading || !newRobotName.trim()}
          />
        </div>
        {createError ? (
          <p className="mt-2 text-xs font-semibold text-rose-300">{createError}</p>
        ) : null}
        <p className="mt-2 text-xs text-slate-400">
          ON robots join via the same game session as real users. OFF robots are ignored.
        </p>
      </PanelCard>

      <PanelCard
        title="Robot Game Advantage"
        subtitle="Controls how quickly robots complete and win by ball count"
      >
        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-white">Robot Game Advantage</p>
              <span className="rounded-full border border-indigo-400/30 bg-indigo-500/10 px-2.5 py-0.5 text-xs font-bold text-indigo-200">
                {advantagePreview.effectLabel === 'FAIR'
                  ? 'Fair play'
                  : `${advantagePreview.effectLabel} advantage`}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={advantageDraft}
              onChange={(e) => setAdvantageDraft(Number(e.target.value))}
              className="mt-3 w-full accent-indigo-400"
            />
            <div className="mt-1 flex justify-between text-xs text-slate-400">
              <span>0 — fair</span>
              <span className="font-bold tabular-nums text-white">{advantageDraft}</span>
              <span>100 — fastest</span>
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-slate-300">
            {advantagePreview.targetWinBallCount == null ? (
              <p>Robots play at natural speed with no win-timing assist.</p>
            ) : advantagePreview.targetWinBallCountMin !==
                advantagePreview.targetWinBallCountMax &&
              advantagePreview.targetWinBallCountMin != null &&
              advantagePreview.targetWinBallCountMax != null ? (
              <p>
                Robots typically win after{' '}
                <span className="font-bold text-white">
                  {advantagePreview.targetWinBallCountMin}–
                  {advantagePreview.targetWinBallCountMax}
                </span>{' '}
                ball calls (~{advantagePreview.targetWinBallCount} average).
              </p>
            ) : (
              <p>
                Robots typically win after approximately{' '}
                <span className="font-bold text-white">
                  {advantagePreview.targetWinBallCount}
                </span>{' '}
                ball calls.
              </p>
            )}
            <p className="mt-2 text-slate-400">
              Reference: 20% → ~20 • 40% → ~15 • 60% → 9–13 • 80% → 6–9 • 100% → ~5
              balls. Applies to all active robots; updates when saved.
            </p>
          </div>

          <ActionButton
            label={actionLoading ? 'Saving…' : 'Save advantage'}
            onClick={onSaveAdvantage}
            disabled={actionLoading}
          />
        </div>
      </PanelCard>

      <PanelCard
        title="Config"
        subtitle="Server-side robot scheduling + stake limits"
      >
        {configDraft ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">Global enabled</p>
                <p className="text-xs text-slate-400">Master kill switch</p>
              </div>
              <label className="flex cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  checked={configDraft.enabledGlobal}
                  onChange={(e) =>
                    setConfigDraft({ ...configDraft, enabledGlobal: e.target.checked })
                  }
                />
                <span className="text-sm font-bold text-white">
                  {configDraft.enabledGlobal ? 'ON' : 'OFF'}
                </span>
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="rounded-xl border border-white/10 bg-white/5 p-3">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Min cartelas
                </span>
                <input
                  className="mt-2 w-full bg-transparent text-sm font-bold text-white outline-none"
                  type="number"
                  value={configDraft.minCards}
                  min={1}
                  max={2}
                  onChange={(e) =>
                    setConfigDraft({ ...configDraft, minCards: Number(e.target.value) })
                  }
                />
              </label>
              <label className="rounded-xl border border-white/10 bg-white/5 p-3">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Max cartelas
                </span>
                <input
                  className="mt-2 w-full bg-transparent text-sm font-bold text-white outline-none"
                  type="number"
                  value={configDraft.maxCards}
                  min={1}
                  max={2}
                  onChange={(e) =>
                    setConfigDraft({ ...configDraft, maxCards: Number(e.target.value) })
                  }
                />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="rounded-xl border border-white/10 bg-white/5 p-3">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Max active robots
                </span>
                <input
                  className="mt-2 w-full bg-transparent text-sm font-bold text-white outline-none"
                  type="number"
                  value={configDraft.maxActiveRobots}
                  min={0}
                  max={200}
                  onChange={(e) =>
                    setConfigDraft({
                      ...configDraft,
                      maxActiveRobots: Number(e.target.value),
                    })
                  }
                />
              </label>
              <label className="rounded-xl border border-white/10 bg-white/5 p-3">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Activity level
                </span>
                <input
                  className="mt-2 w-full bg-transparent text-sm font-bold text-white outline-none"
                  type="number"
                  step={0.1}
                  value={configDraft.activityLevel}
                  min={0}
                  max={1.5}
                  onChange={(e) =>
                    setConfigDraft({
                      ...configDraft,
                      activityLevel: Number(e.target.value),
                    })
                  }
                />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="rounded-xl border border-white/10 bg-white/5 p-3">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Join jitter (ms)
                </span>
                <input
                  className="mt-2 w-full bg-transparent text-sm font-bold text-white outline-none"
                  type="number"
                  value={configDraft.joinJitterMs}
                  min={0}
                  onChange={(e) =>
                    setConfigDraft({
                      ...configDraft,
                      joinJitterMs: Number(e.target.value),
                    })
                  }
                />
              </label>
              <label className="rounded-xl border border-white/10 bg-white/5 p-3">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Leave jitter (ms)
                </span>
                <input
                  className="mt-2 w-full bg-transparent text-sm font-bold text-white outline-none"
                  type="number"
                  value={configDraft.leaveJitterMs}
                  min={0}
                  onChange={(e) =>
                    setConfigDraft({
                      ...configDraft,
                      leaveJitterMs: Number(e.target.value),
                    })
                  }
                />
              </label>
            </div>

            <ActionButton
              label={actionLoading ? 'Saving…' : 'Save config'}
              onClick={onSaveConfig}
              disabled={actionLoading}
            />
          </div>
        ) : (
          <p className="text-sm text-slate-400">No config loaded.</p>
        )}

        <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-3">
          <p className="text-sm font-bold">Robot bank top up</p>
          <p className="mt-1 text-xs text-slate-400">
            Debit/credit is server-side; robots never alter ball draws.
          </p>
          <div className="mt-3 flex items-center gap-3">
            <input
              className="w-32 rounded-xl border border-white/10 bg-transparent px-3 py-2 text-sm font-bold text-white outline-none"
              type="number"
              value={bankTopup}
              min={0}
              onChange={(e) => setBankTopup(Number(e.target.value))}
            />
            <ActionButton
              label={actionLoading ? 'Top up…' : 'Top up'}
              onClick={onTopupBank}
              disabled={actionLoading}
            />
          </div>
        </div>
      </PanelCard>

      <PanelCard title="Robots" subtitle="Manage robots — ON/OFF controls participation">
        {loading ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : robots.length === 0 ? (
          <p className="text-sm text-slate-400">No robots configured.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-separate border-spacing-0">
              <thead>
                <tr className="text-left text-xs text-slate-400">
                  <th className="pb-3 pr-3">Name</th>
                  <th className="pb-3 pr-3">Status</th>
                  <th className="pb-3 pr-3">Active</th>
                  <th className="pb-3 pr-3">Games</th>
                  <th className="pb-3 pr-3">Wins</th>
                  <th className="pb-3 pr-3">Losses</th>
                  <th className="pb-3 pr-3">Stake</th>
                  <th className="pb-3 pr-3">Net PnL</th>
                  <th className="pb-3 pr-3">Active games</th>
                </tr>
              </thead>
              <tbody>
                {robots.map((r) => (
                  <tr
                    key={r.robotId}
                    className="border-t border-white/5 text-sm text-slate-200"
                  >
                    <td className="py-3 pr-3">
                      <div className="flex items-center gap-3">
                        <RobotAvatar seed={r.avatarSeed} name={r.displayName} />
                        <div className="min-w-0">
                          <div className="truncate font-semibold">{r.name ?? r.displayName}</div>
                          <div className="truncate text-xs text-slate-500">{r.robotId}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 pr-3">
                      <label className="inline-flex cursor-pointer items-center gap-2">
                        <input
                          type="checkbox"
                          checked={r.status === 'on' || r.enabled}
                          onChange={(e) => onToggleRobot(r, e.target.checked)}
                        />
                        <span
                          className={`text-xs font-bold ${
                            r.status === 'on' || r.enabled
                              ? 'text-emerald-300'
                              : 'text-slate-400'
                          }`}
                        >
                          {r.status === 'on' || r.enabled ? 'ON' : 'OFF'}
                        </span>
                      </label>
                    </td>
                    <td className="py-3 pr-3">
                      {r.active ? (
                        <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-bold text-emerald-200 border border-emerald-500/20">
                          YES
                        </span>
                      ) : (
                        <span className="rounded-full bg-white/5 px-2 py-0.5 text-xs font-bold text-slate-300 border border-white/10">
                          —
                        </span>
                      )}
                    </td>
                    <td className="py-3 pr-3 tabular-nums">{r.stats.gamesPlayed}</td>
                    <td className="py-3 pr-3 tabular-nums">{r.stats.wins}</td>
                    <td className="py-3 pr-3 tabular-nums">{r.stats.losses}</td>
                    <td className="py-3 pr-3 tabular-nums">{r.stats.totalStake}</td>
                    <td className="py-3 pr-3 tabular-nums">{r.stats.netPnl}</td>
                    <td className="py-3 pr-3 tabular-nums">{r.stats.activeGames}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PanelCard>

      <PanelCard
        title="Robot Activity"
        subtitle="Join/leave/claim events (live)"
        right={<span className="text-xs font-bold text-indigo-300">{activity.length} events</span>}
      >
        <div className="max-h-[420px] overflow-y-auto">
          {activity.length === 0 ? (
            <p className="text-sm text-slate-400">No robot events yet.</p>
          ) : (
            <ul className="space-y-2">
              {activity.map((e, idx) => (
                <li key={`${e.at}-${idx}`} className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <div className="text-xs text-slate-400">{String(e.type)}</div>
                  <div className="mt-1 text-sm font-semibold text-white/90">
                    {formatActivity(e)}
                  </div>
                  {e.cartelIds && e.cartelIds.length ? (
                    <div className="mt-2 text-xs text-slate-400">
                      Cartelas: {e.cartelIds.join(', ')}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </PanelCard>
    </div>
  );
}

