import { useEffect, useState } from 'react';
import PanelCard from '../components/PanelCard';
import NumberBoard from '../components/NumberBoard';
import { useGame } from '../context/GameContext';
import { fetchDashboard, fetchDailyProfit, fetchFinancialSummary } from '../services/api';
import {
  subscribeDashboardUpdates,
  subscribeDailyProfitUpdates,
  subscribeFinancialSummaryUpdates,
} from '../services/socket';
import type {
  DailyProfitSummary,
  FinancialPeriodKey,
  FinancialSummary,
  WithdrawRequestStats,
} from '../types';

const FINANCIAL_PERIOD_OPTIONS: { key: FinancialPeriodKey; label: string }[] = [
  { key: 'last24h', label: 'Last 24 Hours' },
  { key: 'today', label: 'Today' },
  { key: 'last7days', label: 'Last 7 Days' },
  { key: 'thisMonth', label: 'This Month' },
  { key: 'lifetime', label: 'Lifetime' },
];

const EMPTY_FINANCIAL_PERIOD = {
  depositTotal: 0,
  depositCount: 0,
  withdrawalTotal: 0,
  withdrawalCount: 0,
  netRevenue: 0,
};

const EMPTY_FINANCIAL: FinancialSummary = {
  ok: true,
  generatedAt: '',
  currency: 'ETB',
  periods: {
    last24h: { ...EMPTY_FINANCIAL_PERIOD },
    today: { ...EMPTY_FINANCIAL_PERIOD },
    last7days: { ...EMPTY_FINANCIAL_PERIOD },
    thisMonth: { ...EMPTY_FINANCIAL_PERIOD },
    lifetime: { ...EMPTY_FINANCIAL_PERIOD },
  },
};

function formatEtb(amount: number) {
  return `${Math.floor(Number(amount) || 0).toLocaleString()} ETB`;
}

const EMPTY_PROFIT: DailyProfitSummary = {
  ok: true,
  today: {
    date: '—',
    totalGamesPlayed: 0,
    gamesCount: 0,
    totalBets: 0,
    totalRevenue: 0,
    totalPayouts: 0,
    houseProfit: 0,
    netProfit: 0,
  },
  yesterday: {
    date: '—',
    totalGamesPlayed: 0,
    gamesCount: 0,
    totalBets: 0,
    totalRevenue: 0,
    totalPayouts: 0,
    houseProfit: 0,
    netProfit: 0,
  },
  weekly: {
    date: 'weekly',
    totalGamesPlayed: 0,
    gamesCount: 0,
    totalBets: 0,
    totalRevenue: 0,
    totalPayouts: 0,
    houseProfit: 0,
    netProfit: 0,
    from: '—',
    to: '—',
    days: [],
  },
};

function FinancialStat({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string | number;
  tone?: 'neutral' | 'inflow' | 'outflow' | 'net';
}) {
  const cardClass =
    tone === 'inflow'
      ? 'border-emerald-400/25 bg-emerald-500/10'
      : tone === 'outflow'
        ? 'border-rose-400/25 bg-rose-500/10'
        : tone === 'net'
          ? 'border-indigo-400/25 bg-indigo-500/10'
          : 'border-white/10 bg-white/5';

  const valueClass =
    tone === 'inflow'
      ? 'text-emerald-200'
      : tone === 'outflow'
        ? 'text-rose-200'
        : tone === 'net'
          ? 'text-indigo-100'
          : 'text-white';

  return (
    <div className={`rounded-xl border p-3 ${cardClass}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        {label}
      </p>
      <p className={`mt-1 text-xl font-extrabold tabular-nums sm:text-2xl ${valueClass}`}>
        {value}
      </p>
    </div>
  );
}

function ProfitStat({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string | number;
  accent?: boolean;
}) {
  return (
    <div
      className={[
        'rounded-xl border p-3',
        accent
          ? 'border-emerald-400/25 bg-emerald-500/10'
          : 'border-white/10 bg-white/5',
      ].join(' ')}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        {label}
      </p>
      <p
        className={[
          'mt-1 text-2xl font-extrabold tabular-nums',
          accent ? 'text-emerald-200' : 'text-white',
        ].join(' ')}
      >
        {value}
      </p>
    </div>
  );
}

export default function DashboardPage() {
  const { game, loading } = useGame();
  const [withdrawStats, setWithdrawStats] = useState<WithdrawRequestStats>({
    pending: 0,
    approved: 0,
    rejected: 0,
    total: 0,
  });
  const [dailyProfit, setDailyProfit] = useState<DailyProfitSummary>(EMPTY_PROFIT);
  const [financialSummary, setFinancialSummary] =
    useState<FinancialSummary>(EMPTY_FINANCIAL);
  const [financialPeriod, setFinancialPeriod] =
    useState<FinancialPeriodKey>('today');
  const [financialLoading, setFinancialLoading] = useState(true);

  useEffect(() => {
    fetchDashboard()
      .then((dash) => {
        if (dash.withdrawRequests) setWithdrawStats(dash.withdrawRequests);
        if (dash.dailyProfit) setDailyProfit(dash.dailyProfit);
      })
      .catch(() => {});

    fetchDailyProfit()
      .then((profit) => {
        if (profit?.ok !== false) setDailyProfit(profit);
      })
      .catch(() => {});

    fetchFinancialSummary()
      .then((summary) => {
        if (summary?.ok !== false) setFinancialSummary(summary);
      })
      .catch(() => {})
      .finally(() => setFinancialLoading(false));

    const unsubDashboard = subscribeDashboardUpdates((dash) => {
      if (dash.withdrawRequests) setWithdrawStats(dash.withdrawRequests);
      if (dash.dailyProfit) setDailyProfit(dash.dailyProfit);
    });

    const unsubProfit = subscribeDailyProfitUpdates((profit) => {
      if (profit?.ok !== false) setDailyProfit(profit);
    });

    const unsubFinancial = subscribeFinancialSummaryUpdates((summary) => {
      if (summary?.ok !== false) {
        setFinancialSummary(summary);
        setFinancialLoading(false);
      }
    });

    return () => {
      unsubDashboard();
      unsubProfit();
      unsubFinancial();
    };
  }, []);

  const activeFinancial =
    financialSummary.periods[financialPeriod] ?? EMPTY_FINANCIAL_PERIOD;

  const last20 = (game?.calledNumbers ?? []).slice(-20);
  const newest = game?.latestBall ?? last20.at(-1) ?? null;

  const status = game?.status ?? 'STOPPED';

  return (
    <div className="space-y-4">
      <PanelCard
        title="Financial Summary"
        subtitle="Approved deposits and withdrawals from MongoDB — updates live on approval"
        right={
          financialSummary.generatedAt ? (
            <span className="hidden text-[10px] text-slate-500 sm:inline">
              Updated {new Date(financialSummary.generatedAt).toLocaleTimeString()}
            </span>
          ) : null
        }
      >
        <div className="flex flex-wrap gap-2">
          {FINANCIAL_PERIOD_OPTIONS.map((option) => {
            const active = financialPeriod === option.key;
            return (
              <button
                key={option.key}
                type="button"
                onClick={() => setFinancialPeriod(option.key)}
                className={[
                  'rounded-full border px-3 py-1.5 text-xs font-semibold transition',
                  active
                    ? 'border-indigo-400/40 bg-indigo-500/20 text-indigo-100'
                    : 'border-white/10 bg-white/5 text-slate-400 hover:border-white/20 hover:text-slate-200',
                ].join(' ')}
              >
                {option.label}
              </button>
            );
          })}
        </div>

        {financialLoading ? (
          <p className="mt-4 text-sm text-slate-400">Loading financial summary…</p>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <FinancialStat
              label="Total successful deposits"
              value={formatEtb(activeFinancial.depositTotal)}
              tone="inflow"
            />
            <FinancialStat
              label="Deposit count"
              value={activeFinancial.depositCount.toLocaleString()}
            />
            <FinancialStat
              label="Total approved withdrawals"
              value={formatEtb(activeFinancial.withdrawalTotal)}
              tone="outflow"
            />
            <FinancialStat
              label="Approved withdrawal count"
              value={activeFinancial.withdrawalCount.toLocaleString()}
            />
            <FinancialStat
              label="Net revenue"
              value={formatEtb(activeFinancial.netRevenue)}
              tone="net"
            />
          </div>
        )}

        <p className="mt-4 text-xs text-slate-500">
          Net revenue = successful deposits minus approved withdrawals. Pending,
          rejected, cancelled, and failed transactions are excluded.
        </p>
      </PanelCard>

      <PanelCard
        title="Daily Net Profit"
        subtitle="20% house cut on completed games — updates live after each round"
      >
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <ProfitStat
            label="Today net profit"
            value={`${dailyProfit.today.netProfit} ETB`}
            accent
          />
          <ProfitStat
            label="Yesterday net profit"
            value={`${dailyProfit.yesterday.netProfit} ETB`}
          />
          <ProfitStat
            label="Today games"
            value={dailyProfit.today.gamesCount}
          />
          <ProfitStat
            label="Weekly net profit"
            value={`${dailyProfit.weekly.netProfit} ETB`}
          />
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-white/10 bg-white/5 p-3">
            <p className="text-xs font-bold uppercase tracking-wide text-indigo-200">
              Today ({dailyProfit.today.date})
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-300">
              <p>
                <span className="text-slate-500">Total bets:</span>{' '}
                {dailyProfit.today.totalBets} ETB
              </p>
              <p>
                <span className="text-slate-500">Payouts:</span>{' '}
                {dailyProfit.today.totalPayouts} ETB
              </p>
              <p>
                <span className="text-slate-500">House profit (20%):</span>{' '}
                {dailyProfit.today.houseProfit} ETB
              </p>
              <p>
                <span className="text-slate-500">Games played:</span>{' '}
                {dailyProfit.today.totalGamesPlayed}
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/5 p-3">
            <p className="text-xs font-bold uppercase tracking-wide text-indigo-200">
              Weekly ({dailyProfit.weekly.from} → {dailyProfit.weekly.to})
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-300">
              <p>
                <span className="text-slate-500">Total revenue:</span>{' '}
                {dailyProfit.weekly.totalRevenue} ETB
              </p>
              <p>
                <span className="text-slate-500">Total payouts:</span>{' '}
                {dailyProfit.weekly.totalPayouts} ETB
              </p>
              <p>
                <span className="text-slate-500">House profit:</span>{' '}
                {dailyProfit.weekly.houseProfit} ETB
              </p>
              <p>
                <span className="text-slate-500">Games played:</span>{' '}
                {dailyProfit.weekly.gamesCount}
              </p>
            </div>
          </div>
        </div>
      </PanelCard>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <PanelCard
          title="Game status"
          subtitle="Live status derived from backend state"
          right={<span className="text-xs font-bold text-indigo-300">{status}</span>}
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Game ID
              </p>
              <p className="mt-1 truncate text-sm font-extrabold text-white">
                {game?.gameId ?? '—'}
              </p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Phase
              </p>
              <p className="mt-1 text-sm font-extrabold text-white">
                {game?.lobbyPhase ?? '—'}
              </p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Players
              </p>
              <p className="mt-1 text-2xl font-extrabold tabular-nums text-white">
                {game?.playersCount ?? 0}
              </p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Active players
              </p>
              <p className="mt-1 text-2xl font-extrabold tabular-nums text-white">
                {game?.activePlayersCount ?? 0}
              </p>
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Pool
            </p>
            <p className="mt-1 text-2xl font-extrabold tabular-nums text-white">
              {game?.pot ?? 0} ETB
            </p>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-amber-400/20 bg-amber-500/5 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Pending withdraws
              </p>
              <p className="mt-1 text-2xl font-extrabold tabular-nums text-amber-200">
                {withdrawStats.pending}
              </p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Total withdraw requests
              </p>
              <p className="mt-1 text-2xl font-extrabold tabular-nums text-white">
                {withdrawStats.total}
              </p>
            </div>
          </div>

          {loading ? (
            <p className="mt-4 text-xs text-slate-400">Connecting to game state…</p>
          ) : null}
        </PanelCard>

        <PanelCard
          title="Bingo progress"
          subtitle="Last drawn numbers (max 20)"
        >
          <NumberBoard numbers={last20} newestNumber={newest} limit={20} />
        </PanelCard>
      </div>
    </div>
  );
}
