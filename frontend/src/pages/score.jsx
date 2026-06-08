import { useCallback, useEffect, useState } from 'react';
import ScreenLayout from '../components/ScreenLayout';
import { fetchScoreboard, subscribeStatsUpdates } from '../api/stats';
import { getPlayerUserId } from '../api/playerIdentity';

const RANK_BADGE_STYLES = {
  1: 'bg-gradient-to-br from-amber-300 to-amber-600 text-amber-950 shadow-[0_0_12px_rgba(251,191,36,0.5)]',
  2: 'bg-gradient-to-br from-slate-300 to-slate-500 text-slate-900 shadow-[0_0_10px_rgba(148,163,184,0.4)]',
  3: 'bg-gradient-to-br from-amber-600 to-amber-800 text-amber-100 shadow-[0_0_10px_rgba(180,83,9,0.4)]',
};

function RankBadge({ rank }) {
  if (rank <= 3) {
    return (
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${RANK_BADGE_STYLES[rank]}`}
      >
        {rank}
      </span>
    );
  }

  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/5 text-xs font-semibold text-white/70">
      {rank}
    </span>
  );
}

function LeaderboardRow({ rank, username, games }) {
  return (
    <li className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 py-2.5">
      <RankBadge rank={rank} />
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-white/85">
        {username}
      </span>
      <span className="shrink-0 text-xs tabular-nums text-white/45">
        {games.toLocaleString()} games
      </span>
    </li>
  );
}

function StatPill({ label, value }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1.5 text-center">
      <p className="text-[8px] font-medium uppercase tracking-wide text-white/40">
        {label}
      </p>
      <p className="mt-0.5 text-xs font-bold tabular-nums text-white">{value}</p>
    </div>
  );
}

export default function Score({ activeScreen, onNavigate }) {
  const [activeTab, setActiveTab] = useState('daily');
  const [loading, setLoading] = useState(true);
  const [top10, setTop10] = useState([]);
  const [myStats, setMyStats] = useState(null);
  const [lobbyMeta, setLobbyMeta] = useState({
    onlinePlayers: 0,
    jackpot: 0,
    activeGameId: null,
  });

  const loadScoreboard = useCallback(async (period) => {
    setLoading(true);
    const data = await fetchScoreboard(period, getPlayerUserId());
    if (data) {
      setTop10(Array.isArray(data.top10) ? data.top10 : []);
      setMyStats(data.myStats ?? null);
      setLobbyMeta({
        onlinePlayers: Number(data.onlinePlayers) || 0,
        jackpot: Number(data.jackpot) || 0,
        activeGameId: data.activeGameId ?? null,
      });
    } else {
      setTop10([]);
      setMyStats(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadScoreboard(activeTab);
  }, [activeTab, loadScoreboard]);

  useEffect(() => {
    const unsubscribe = subscribeStatsUpdates(() => {
      loadScoreboard(activeTab);
    });
    return unsubscribe;
  }, [activeTab, loadScoreboard]);

  const myRankDisplay = myStats?.rank != null ? `#${myStats.rank.toLocaleString()}` : '—';
  const myGamesDisplay = myStats?.gamesPlayed ?? '—';
  const myUsername = myStats?.username ?? '@PLAYER';

  return (
    <ScreenLayout
      activeScreen={activeScreen}
      onNavigate={onNavigate}
      contentVariant="fill"
    >
      <div className="flex min-h-0 w-full flex-1 flex-col gap-3 overflow-hidden">
        <div className="grid shrink-0 grid-cols-3 gap-2">
          <StatPill label="ONLINE" value={loading ? '…' : lobbyMeta.onlinePlayers} />
          <StatPill
            label="JACKPOT"
            value={loading ? '…' : `${lobbyMeta.jackpot} ETB`}
          />
          <StatPill
            label="LIVE GAME"
            value={
              loading
                ? '…'
                : lobbyMeta.activeGameId
                  ? 'ACTIVE'
                  : 'NONE'
            }
          />
        </div>

        <div className="shrink-0 overflow-hidden rounded-2xl bg-gradient-to-br from-violet-600 via-purple-600 to-blue-600 p-3 shadow-[0_8px_32px_rgba(124,58,237,0.35)] sm:p-4">
          <p className="text-[10px] font-semibold tracking-[0.2em] text-white/70">
            MY RANK
          </p>
          <div className="mt-3 flex items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-base font-bold text-white">
                {loading ? '…' : myUsername}
              </p>
              <p className="mt-0.5 text-2xl font-extrabold tabular-nums text-white">
                {loading ? '…' : myRankDisplay}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-[10px] font-medium tracking-wide text-white/60">
                GAMES PLAYED
              </p>
              <p className="mt-0.5 text-xl font-bold tabular-nums text-white">
                {loading ? '…' : myGamesDisplay}
              </p>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 rounded-full border border-white/10 bg-white/[0.04] p-1">
          {['daily', 'weekly'].map((key) => {
            const label = key === 'daily' ? 'DAILY' : 'WEEKLY';
            const active = activeTab === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setActiveTab(key)}
                className={`min-h-[40px] flex-1 touch-manipulation rounded-full py-2 text-center text-xs font-semibold tracking-wider transition ${
                  active
                    ? 'bg-white/15 text-white shadow-inner'
                    : 'text-white/40 hover:text-white/60'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <p className="mb-2 shrink-0 text-[10px] font-semibold tracking-[0.2em] text-white/45">
            TOP 10 PLAYERS
          </p>
          {loading ? (
            <div className="flex flex-1 items-center justify-center text-sm text-white/35">
              Loading leaderboard…
            </div>
          ) : top10.length === 0 ? (
            <div className="flex flex-1 items-center justify-center text-center text-sm text-white/35">
              No games recorded yet for this period.
            </div>
          ) : (
            <ul
              key={activeTab}
              className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              {top10.map((player) => (
                <LeaderboardRow
                  key={`${activeTab}-${player.rank}-${player.userId}`}
                  rank={player.rank}
                  username={player.username}
                  games={player.games}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </ScreenLayout>
  );
}
