import { useCallback, useEffect, useState } from 'react';
import PanelCard from '../components/PanelCard';
import {
  banUser,
  fetchManagedUsers,
  getApiErrorMessage,
  makeUserAdmin,
  makeUserManager,
  removeUserAdmin,
  removeUserManager,
  unbanUser,
  type ManagedUser,
} from '../services/api';

function RoleBadge({ role }: { role: string }) {
  const colors =
    role === 'manager'
      ? 'bg-violet-500/20 text-violet-200 border-violet-400/30'
      : role === 'admin'
        ? 'bg-amber-500/20 text-amber-200 border-amber-400/30'
        : 'bg-slate-500/20 text-slate-200 border-slate-400/20';
  return (
    <span className={`rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase ${colors}`}>
      {role}
    </span>
  );
}

export default function UserManagementPage() {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [banReasons, setBanReasons] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchManagedUsers({
        limit: 100,
        search: search.trim() || undefined,
      });
      setUsers(data.users ?? []);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Failed to load users'));
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    void load();
  }, [load]);

  async function runAction(
    label: string,
    fn: () => Promise<{ user?: ManagedUser }>
  ) {
    setStatus('');
    setError('');
    try {
      const result = await fn();
      if (result.user) {
        setUsers((prev) =>
          prev.map((u) => (u.userId === result.user!.userId ? result.user! : u))
        );
      } else {
        await load();
      }
      setStatus(label);
    } catch (err) {
      setError(getApiErrorMessage(err, 'Action failed'));
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PanelCard
        title="User Management"
        subtitle="Managers can assign roles and ban users. Admins cannot access this page."
      >
        <div className="mb-4 flex flex-wrap gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by Telegram ID or username…"
            className="min-w-[200px] flex-1 rounded-xl border border-white/10 bg-[#0f172a] px-3 py-2 text-sm text-white outline-none focus:border-indigo-400/60"
          />
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-xl border border-indigo-400/30 bg-indigo-500/20 px-4 py-2 text-sm font-bold text-indigo-100"
          >
            Search
          </button>
        </div>

        {error ? <p className="mb-3 text-sm font-semibold text-rose-300">{error}</p> : null}
        {status ? <p className="mb-3 text-sm font-semibold text-emerald-300">{status}</p> : null}

        {loading ? (
          <p className="text-sm text-slate-400">Loading users…</p>
        ) : users.length === 0 ? (
          <p className="text-sm text-slate-400">No users found.</p>
        ) : (
          <div className="space-y-3">
            {users.map((user) => (
              <div
                key={user.userId}
                className="rounded-xl border border-white/10 bg-white/5 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-bold text-white">{user.username || user.userId}</p>
                    <p className="mt-1 text-xs text-slate-400">
                      Telegram ID: <span className="text-slate-200">{user.telegramId}</span>
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <RoleBadge role={user.role} />
                      <span
                        className={`text-[10px] font-bold uppercase ${
                          user.isBanned ? 'text-rose-300' : 'text-emerald-300'
                        }`}
                      >
                        {user.status}
                      </span>
                    </div>
                    {user.isBanned && user.banReason ? (
                      <p className="mt-2 text-xs text-rose-200/80">Reason: {user.banReason}</p>
                    ) : null}
                  </div>

                  <div className="flex max-w-md flex-col gap-2">
                    {user.role === 'user' && !user.isBanned ? (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            void runAction('User promoted to Admin', () =>
                              makeUserAdmin(user.userId)
                            )
                          }
                          className="rounded-lg border border-amber-400/30 bg-amber-500/15 px-3 py-1.5 text-xs font-bold text-amber-100"
                        >
                          Make Admin
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void runAction('User promoted to Manager', () =>
                              makeUserManager(user.userId)
                            )
                          }
                          className="rounded-lg border border-violet-400/30 bg-violet-500/15 px-3 py-1.5 text-xs font-bold text-violet-100"
                        >
                          Make Manager
                        </button>
                      </>
                    ) : null}

                    {user.role === 'admin' && !user.isBanned ? (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            void runAction('Admin role removed', () =>
                              removeUserAdmin(user.userId)
                            )
                          }
                          className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-bold text-slate-200"
                        >
                          Remove Admin
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void runAction('User promoted to Manager', () =>
                              makeUserManager(user.userId)
                            )
                          }
                          className="rounded-lg border border-violet-400/30 bg-violet-500/15 px-3 py-1.5 text-xs font-bold text-violet-100"
                        >
                          Make Manager
                        </button>
                      </>
                    ) : null}

                    {user.role === 'manager' && !user.isBanned ? (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            void runAction('Manager demoted to Admin', () =>
                              removeUserManager(user.userId, 'admin')
                            )
                          }
                          className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-bold text-slate-200"
                        >
                          Remove Manager → Admin
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void runAction('Manager demoted to User', () =>
                              removeUserManager(user.userId, 'user')
                            )
                          }
                          className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-bold text-slate-200"
                        >
                          Remove Manager → User
                        </button>
                      </>
                    ) : null}

                    {!user.isBanned ? (
                      <div className="flex flex-col gap-1">
                        <input
                          value={banReasons[user.userId] ?? ''}
                          onChange={(e) =>
                            setBanReasons((prev) => ({
                              ...prev,
                              [user.userId]: e.target.value,
                            }))
                          }
                          placeholder="Ban reason (optional)"
                          className="rounded-lg border border-white/10 bg-[#0f172a] px-2 py-1 text-xs text-white outline-none"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            void runAction('User banned', () =>
                              banUser(user.userId, banReasons[user.userId])
                            )
                          }
                          className="rounded-lg border border-rose-400/40 bg-rose-500/15 px-3 py-1.5 text-xs font-bold text-rose-100"
                        >
                          Ban User
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() =>
                          void runAction('User unbanned', () => unbanUser(user.userId))
                        }
                        className="rounded-lg border border-emerald-400/40 bg-emerald-500/15 px-3 py-1.5 text-xs font-bold text-emerald-100"
                      >
                        Unban User
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </PanelCard>
    </div>
  );
}
