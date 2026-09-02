import { Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useGame } from '../context/GameContext';
import Sidebar from './Sidebar';

export default function AdminLayout() {
  const { logout } = useAuth();
  const { game } = useGame();

  const statusLabel = game?.status ?? 'STOPPED';
  const newest = game?.latestBall ?? (game?.calledNumbers?.at(-1) ?? null);

  return (
    <div className="min-h-screen bg-[#0a0a14] text-slate-100">
      <div className="flex min-h-screen">
        <Sidebar />

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="border-b border-panel-border px-6 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <h1 className="truncate text-lg font-bold tracking-wide text-white/90">
                  CAPITAL BINGO Admin Dashboard
                </h1>
                <p className="mt-1 text-xs text-slate-400">
                  Game: {game?.gameId ? game.gameId : '—'} • Status:{' '}
                  <span className="font-semibold text-indigo-300">
                    {statusLabel}
                  </span>
                </p>
              </div>

              <div className="flex items-center gap-2">
                {newest != null ? (
                  <div className="rounded-lg border border-indigo-400/20 bg-indigo-500/10 px-3 py-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      Newest number
                    </p>
                    <p className="text-xl font-extrabold tabular-nums text-indigo-200">
                      {newest}
                    </p>
                  </div>
                ) : null}

                <button
                  type="button"
                  onClick={logout}
                  className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/80 hover:bg-white/10"
                >
                  Logout
                </button>
              </div>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto px-6 py-6">
            <Outlet />
          </div>
        </div>
      </div>
    </div>
  );
}


