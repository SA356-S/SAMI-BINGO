import { useMemo } from 'react';
import PanelCard from '../components/PanelCard';
import { useGame } from '../context/GameContext';

export default function CartelasPage() {
  const { game } = useGame();
  const cartelas = game?.cartelas ?? [];

  const grouped = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const c of cartelas) {
      const key = c.playerName || c.userId || 'Player';
      const list = map.get(key) ?? [];
      list.push(c.cartelId);
      map.set(key, list);
    }
    const out = [...map.entries()].map(([playerName, ids]) => ({
      playerName,
      cartelIds: ids.sort((a, b) => a - b),
    }));
    out.sort((a, b) => b.cartelIds.length - a.cartelIds.length);
    return out;
  }, [cartelas]);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <PanelCard
        title="Cartelas"
        subtitle="Sold cartelas grouped by player"
        right={
          <span className="text-xs font-bold text-indigo-300">
            Sold: {game?.soldCartelasCount ?? 0}
          </span>
        }
      >
        {cartelas.length === 0 ? (
          <p className="text-sm text-slate-400">
            No sold cartelas yet.
          </p>
        ) : (
          <div className="space-y-3">
            {grouped.map((g) => (
              <div
                key={g.playerName}
                className="rounded-xl border border-white/10 bg-white/5 p-4"
              >
                <p className="text-sm font-extrabold text-white">
                  {g.playerName}
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  Cartelas: {g.cartelIds.length}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {g.cartelIds.map((id) => (
                    <span
                      key={id}
                      className="rounded-lg border border-indigo-400/20 bg-indigo-500/10 px-3 py-1 text-xs font-bold text-indigo-200"
                    >
                      #{id}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </PanelCard>

      <PanelCard
        title="Raw sold cartelas feed"
        subtitle="Flat list coming from backend session snapshot"
      >
        {cartelas.length === 0 ? (
          <p className="text-sm text-slate-400">
            Nothing to display.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-separate border-spacing-0">
              <thead>
                <tr className="text-left text-xs text-slate-400">
                  <th className="pb-3 pr-3">Cartela</th>
                  <th className="pb-3 pr-3">Player</th>
                  <th className="pb-3 pr-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {cartelas.map((c) => (
                  <tr key={`${c.playerName}-${c.cartelId}`} className="border-t border-white/5 text-sm text-slate-200">
                    <td className="py-3 pr-3 font-bold">#{c.cartelId}</td>
                    <td className="py-3 pr-3">{c.playerName}</td>
                    <td className="py-3 pr-3">{c.status}</td>
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

