import PanelCard from '../components/PanelCard';
import { useGame } from '../context/GameContext';

function StatusPill({ status }: { status: string }) {
  const color =
    status === 'active'
      ? 'bg-emerald-500/10 text-emerald-200 border-emerald-500/20'
      : status === 'away'
        ? 'bg-amber-500/10 text-amber-200 border-amber-500/20'
        : 'bg-white/5 text-slate-300 border-white/10';

  return (
    <span className={['rounded-full border px-2 py-0.5 text-xs font-bold', color].join(' ')}>
      {status}
    </span>
  );
}

export default function PlayersPage() {
  const { game } = useGame();

  const players = game?.players ?? [];
  const activePlayers = players.filter((p) => p.status === 'active');

  return (
    <div className="grid grid-cols-1 gap-4">
      <PanelCard
        title="Players"
        subtitle="All seated players in the active session"
        right={
          <span className="text-xs font-semibold text-indigo-300">
            {activePlayers.length} active
          </span>
        }
      >
        <div className="mb-4 flex flex-wrap gap-3">
          <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Total
            </p>
            <p className="mt-1 text-2xl font-extrabold tabular-nums text-white">
              {players.length}
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Active
            </p>
            <p className="mt-1 text-2xl font-extrabold tabular-nums text-white">
              {activePlayers.length}
            </p>
          </div>
        </div>

        {players.length === 0 ? (
          <p className="text-sm text-slate-400">No players yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-separate border-spacing-0">
              <thead>
                <tr className="text-left text-xs text-slate-400">
                  <th className="pb-3 pr-3">Seat</th>
                  <th className="pb-3 pr-3">Player</th>
                  <th className="pb-3 pr-3">Cartelas</th>
                  <th className="pb-3 pr-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {players.map((p) => (
                  <tr
                    key={p.socketId}
                    className="border-t border-white/5 text-sm text-slate-200"
                  >
                    <td className="py-3 pr-3">{p.seatNumber}</td>
                    <td className="py-3 pr-3">
                      <div className="font-semibold">{p.displayName}</div>
                      <div className="text-xs text-slate-500">
                        {p.userId ?? '—'}
                      </div>
                    </td>
                    <td className="py-3 pr-3">{p.cartelCount}</td>
                    <td className="py-3 pr-3">
                      <StatusPill status={p.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PanelCard>
    </div>
  );
}

