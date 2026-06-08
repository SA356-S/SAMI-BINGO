import { useCallback, useEffect, useState } from 'react';
import { Gamepad2, Trophy } from 'lucide-react';
import ScreenLayout from '../components/ScreenLayout';
import { fetchGameHistory, subscribeStatsUpdates } from '../api/stats';
import { getPlayerUserId } from '../api/playerIdentity';

const WIN_COLOR = '#11CAA0';

function HistoryRow({ item }) {
  const isVictory = item.type === 'victory';

  return (
    <li className="flex items-start gap-3 rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 py-3">
      <span
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
          isVictory ? 'bg-[#11CAA0]/15' : 'bg-white/5'
        }`}
      >
        {isVictory ? (
          <Trophy
            className="h-5 w-5"
            style={{ color: WIN_COLOR }}
            strokeWidth={2}
          />
        ) : (
          <Gamepad2 className="h-5 w-5 text-white/35" strokeWidth={1.75} />
        )}
      </span>

      <div className="min-w-0 flex-1">
        <p
          className={
            isVictory
              ? 'text-xs font-bold tracking-wide text-[#11CAA0]'
              : 'text-xs font-bold tracking-wide text-white/40'
          }
        >
          {isVictory ? 'BINGO VICTORY' : 'GAME FINISHED'}
        </p>
        <p className="mt-1 text-[11px] font-medium text-white/70">
          {item.gameId}
        </p>
        <p className="mt-0.5 text-[10px] text-white/40">
          STAKE: {item.stake} ETB · {item.date} · {item.time}
        </p>
      </div>

      <div className="shrink-0 pt-0.5 text-right">
        {isVictory ? (
          <p className="text-sm font-bold tabular-nums text-[#11CAA0]">
            +{item.amount} ETB
          </p>
        ) : (
          <p className="text-sm font-semibold tabular-nums text-white/35">
            0 ETB
          </p>
        )}
      </div>
    </li>
  );
}

export default function History({ activeScreen, onNavigate }) {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState({ totalPlayed: 0, totalWins: 0 });
  const [items, setItems] = useState([]);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    const data = await fetchGameHistory(getPlayerUserId());
    setSummary(data?.summary ?? { totalPlayed: 0, totalWins: 0 });
    setItems(Array.isArray(data?.items) ? data.items : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadHistory();
    const unsubscribe = subscribeStatsUpdates(loadHistory);
    return unsubscribe;
  }, [loadHistory]);

  return (
    <ScreenLayout
      activeScreen={activeScreen}
      onNavigate={onNavigate}
      contentVariant="fill"
    >
      <div className="flex min-h-0 w-full flex-1 flex-col gap-2 pt-2 sm:gap-3 sm:pt-3">
        {/* Summary header */}
        <section className="shrink-0 overflow-visible">
          <h2 className="whitespace-normal text-sm font-bold leading-normal tracking-[0.12em] text-white/90">
            GAME HISTORY
          </h2>
          <p className="mt-0.5 text-[10px] tracking-[0.12em] text-white/40">
            YOUR RECENT SESSIONS
          </p>

          <div className="mt-2 grid grid-cols-2 gap-2 sm:gap-3">
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2.5">
              <p className="text-[9px] font-semibold tracking-[0.15em] text-white/45">
                TOTAL PLAYED
              </p>
              <p className="mt-1 text-lg font-bold text-white">
                {loading ? '…' : summary.totalPlayed}{' '}
                <span className="text-sm font-medium text-white/50">Games</span>
              </p>
            </div>
            <div className="rounded-xl border border-[#11CAA0]/25 bg-[#11CAA0]/10 px-3 py-2.5">
              <p className="text-[9px] font-semibold tracking-[0.15em] text-[#11CAA0]/80">
                TOTAL WINS
              </p>
              <p className="mt-1 text-lg font-bold text-[#11CAA0]">
                {loading ? '…' : summary.totalWins}{' '}
                <span className="text-sm font-medium text-[#11CAA0]/70">
                  Bingos
                </span>
              </p>
            </div>
          </div>
        </section>

        {/* Activity list */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <p className="mb-1.5 shrink-0 text-[10px] font-semibold tracking-[0.2em] text-white/45">
            RECENT ACTIVITY
          </p>
          {loading ? (
            <p className="py-4 text-center text-sm text-white/35">
              Loading history…
            </p>
          ) : items.length === 0 ? (
            <p className="py-4 text-center text-sm text-white/35">
              No games played yet. Start a round from Play 10.
            </p>
          ) : (
            <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {items.map((item) => (
                <HistoryRow key={item.id} item={item} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </ScreenLayout>
  );
}
