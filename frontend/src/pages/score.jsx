import { useCallback, useEffect, useState } from 'react';
import Navbar from '../components/Navbar';
import { fetchScoreboard, subscribeStatsUpdates } from '../api/stats';
import { getPlayerUserId } from '../api/playerIdentity';

const LIST_CARD =
  'rounded-[18px] border border-white/[0.05] bg-[#1a1d2e]';

const RANK_BADGE_STYLES = {
  1: 'bg-amber-400 text-[#1a1200]',
  2: 'bg-slate-300 text-[#111827]',
  3: 'bg-orange-500 text-[#1a0d00]',
};

function RankBadge({ rank }) {
  const tone =
    RANK_BADGE_STYLES[rank] ?? 'bg-[#252a3d] text-slate-400';

  return (
    <span
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] text-sm font-bold tabular-nums ${tone}`}
    >
      {rank}
    </span>
  );
}

function LeaderboardRow({ rank, username, games }) {
  return (
    <li className={`flex items-center gap-3 px-3.5 py-3 ${LIST_CARD}`}>
      <RankBadge rank={rank} />
      <span className="min-w-0 flex-1 truncate text-[15px] font-bold uppercase tracking-[0.02em] text-white">
        {username}
      </span>
      <div className="shrink-0 text-right">
        <p className="text-[1.35rem] font-bold leading-none tabular-nums text-white">
          {games.toLocaleString()}
        </p>
        <p className="mt-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-500">
          GAMES
        </p>
      </div>
    </li>
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

  const gamesPlayed = myStats?.gamesPlayed ?? 0;
  const myRankDisplay =
    myStats?.rank != null ? `#${myStats.rank.toLocaleString()}` : '—';
  const myRankLeft =
    loading || gamesPlayed === 0 ? (loading ? '…' : '—') : myRankDisplay;
  const myGamesDisplay = loading ? '…' : gamesPlayed;
  const myUsername = loading ? '…' : myStats?.username ?? '@PLAYER';
  const showUnranked = !loading && gamesPlayed === 0;

  return (
    <div className="relative flex h-[100dvh] max-h-[100dvh] w-full max-w-[100vw] flex-col overflow-hidden bg-[#0b0e1e] font-sans text-white">
      <div
        className="pointer-events-none absolute inset-0 overflow-hidden"
        aria-hidden
      >
        <div className="absolute left-1/2 top-0 h-52 w-52 -translate-x-1/2 rounded-full bg-violet-900/20 blur-[90px]" />
        <div className="absolute bottom-28 -right-12 h-40 w-40 rounded-full bg-indigo-900/15 blur-[80px]" />
      </div>

      <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden px-3 pb-2 pt-4 sm:px-4 sm:pt-5">
        <section className="shrink-0 overflow-hidden rounded-[22px] bg-gradient-to-r from-[#6332f6] via-[#7a36f5] to-[#8b3af7] px-3.5 py-3.5 shadow-[0_10px_32px_rgba(99,50,246,0.28)] sm:px-4 sm:py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] bg-black/20 text-sm font-bold tabular-nums text-white backdrop-blur-sm">
              {myRankLeft}
            </div>

            <div className="min-w-0 flex-1">
              <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-white/55">
                MY RANK
              </p>
              <p className="mt-0.5 truncate text-[15px] font-bold uppercase tracking-[0.03em] text-white sm:text-base">
                {myUsername}
              </p>
              {showUnranked ? (
                <p className="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-white/50">
                  UNRANKED
                </p>
              ) : null}
            </div>

            <div className="shrink-0 text-right">
              <p className="text-[1.65rem] font-bold leading-none tabular-nums text-white">
                {myGamesDisplay}
              </p>
              <p className="mt-1 text-[9px] font-semibold uppercase tracking-[0.16em] text-white/55">
                PLAYED
              </p>
            </div>
          </div>
        </section>

        <div className="mt-3 flex shrink-0 rounded-full bg-[#12151f] p-1 sm:mt-3.5">
          {['daily', 'weekly'].map((key) => {
            const label = key === 'daily' ? 'DAILY' : 'WEEKLY';
            const active = activeTab === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setActiveTab(key)}
                className={`min-h-[40px] flex-1 touch-manipulation rounded-full py-2 text-center text-[11px] font-bold uppercase tracking-[0.14em] transition ${
                  active
                    ? 'bg-[#2a3044] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        <div className="mt-3 flex min-h-0 flex-1 flex-col overflow-hidden sm:mt-3.5">
          <div className="mb-2.5 flex shrink-0 items-center gap-2">
            <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              TOP 10 PLAYERS
            </p>
            <div className="h-px min-w-0 flex-1 bg-white/[0.06]" aria-hidden />
          </div>

          {loading ? (
            <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
              Loading leaderboard…
            </div>
          ) : top10.length === 0 ? (
            <div className="flex flex-1 items-center justify-center text-center text-sm text-slate-500">
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

      <Navbar activeScreen={activeScreen} onNavigate={onNavigate} embedded />
    </div>
  );
}
