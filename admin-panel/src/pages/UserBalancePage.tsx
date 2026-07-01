import { useCallback, useEffect, useState } from 'react';
import PanelCard from '../components/PanelCard';
import UserSearchBar from '../components/UserSearchBar';
import UserBalanceCard from '../components/UserBalanceCard';
import type { AdminUserRow } from '../types';
import {
  addUserBalance,
  CONNECTING_MESSAGE,
  fetchBackendHealth,
  fetchRecentUsers,
  getApiErrorMessage,
  getNetworkErrorMessage,
  searchUser,
} from '../services/api';
import { getAdminToken } from '../services/auth';

type BackendStatus = 'checking' | 'online' | 'offline';

export default function UserBalancePage() {
  const [query, setQuery] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [matches, setMatches] = useState<AdminUserRow[]>([]);
  const [selectedUser, setSelectedUser] = useState<AdminUserRow | null>(null);
  const [addLoading, setAddLoading] = useState(false);
  const [addMessage, setAddMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [backendStatus, setBackendStatus] = useState<BackendStatus>('checking');
  const [recentLoading, setRecentLoading] = useState(true);

  const loadRecentUsers = useCallback(async () => {
    if (!getAdminToken()) {
      setRecentLoading(false);
      return;
    }

    setRecentLoading(true);
    try {
      const result = await fetchRecentUsers(25);
      const users = result.users ?? [];
      setMatches(users);
      if (users.length === 1) {
        setSelectedUser(users[0]);
      }
    } catch (error) {
      console.warn('[admin] recent users failed', error);
    } finally {
      setRecentLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    fetchBackendHealth()
      .then(() => {
        if (!cancelled) setBackendStatus('online');
      })
      .catch(() => {
        if (!cancelled) setBackendStatus('offline');
      });

    loadRecentUsers();

    return () => {
      cancelled = true;
    };
  }, [loadRecentUsers]);

  const handleSearch = async () => {
    const trimmed = query.trim();
    if (!trimmed) return;

    if (!getAdminToken()) {
      setSearchError('Not logged in. Open the login page and sign in as admin.');
      return;
    }

    setSearchLoading(true);
    setSearchError(null);
    setAddMessage(null);
    setSelectedUser(null);

    try {
      const result = await searchUser(trimmed);
      const users = result.users ?? (result.user ? [result.user] : []);

      if (users.length === 0) {
        setMatches([]);
        setSearchError('No user found for that username or phone number.');
        return;
      }

      setMatches(users);
      setSelectedUser(users.length === 1 ? users[0] : null);
    } catch (error) {
      setMatches([]);
      setSearchError(getApiErrorMessage(error, 'User search failed.'));
    } finally {
      setSearchLoading(false);
    }
  };

  const handleAddMoney = async (amount: number) => {
    if (!selectedUser) return;

    setAddLoading(true);
    setAddMessage(null);

    try {
      const result = await addUserBalance(selectedUser.userId, amount);
      const updated = result.user ?? {
        ...selectedUser,
        mainWallet: result.mainWallet ?? selectedUser.mainWallet,
        playWallet: result.playWallet ?? selectedUser.playWallet,
        totalWalletBalance:
          result.totalWalletBalance ?? selectedUser.totalWalletBalance,
      };

      setSelectedUser(updated);
      setMatches((current) =>
        current.map((row) => (row.userId === updated.userId ? updated : row))
      );
      setAddMessage({
        type: 'success',
        text: `Added ${amount.toLocaleString()} ETB. New balance: ${updated.totalWalletBalance.toLocaleString()} ETB`,
      });
    } catch (error) {
      setAddMessage({
        type: 'error',
        text: getApiErrorMessage(error, 'Failed to add money.'),
      });
    } finally {
      setAddLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {backendStatus === 'offline' ? (
        <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          {getNetworkErrorMessage()}
        </div>
      ) : null}

      <PanelCard
        title="User Balance Manager"
        subtitle="Search registered Telegram users by @username, phone, or Telegram ID"
        right={
          <span
            className={[
              'rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-wider',
              backendStatus === 'online'
                ? 'bg-emerald-500/15 text-emerald-200'
                : backendStatus === 'checking'
                  ? 'bg-slate-500/15 text-slate-300'
                  : 'bg-red-500/15 text-red-200',
            ].join(' ')}
          >
            {backendStatus === 'checking'
              ? CONNECTING_MESSAGE
              : backendStatus === 'online'
                ? 'Backend online'
                : 'Backend offline'}
          </span>
        }
      >
        <UserSearchBar
          query={query}
          loading={searchLoading}
          onQueryChange={setQuery}
          onSearch={handleSearch}
        />

        {searchError ? (
          <p className="mt-4 rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {searchError}
          </p>
        ) : null}

        {!searchLoading && !searchError && matches.length > 1 ? (
          <div className="mt-4 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              {query.trim() ? 'Search results' : 'Recent registered users'} — select
              one
            </p>
            {matches.map((user) => (
              <button
                key={user.userId}
                type="button"
                onClick={() => {
                  setSelectedUser(user);
                  setAddMessage(null);
                }}
                className={[
                  'flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition',
                  selectedUser?.userId === user.userId
                    ? 'border-indigo-400/30 bg-indigo-500/15'
                    : 'border-white/10 bg-white/5 hover:bg-white/10',
                ].join(' ')}
              >
                <div>
                  <p className="text-sm font-bold text-white">{user.name}</p>
                  <p className="mt-1 text-xs text-slate-400">
                    {user.username || 'No username'} • {user.phone || 'No phone'} •
                    ID {user.userId}
                  </p>
                </div>
                <p className="text-sm font-bold tabular-nums text-emerald-200">
                  {user.totalWalletBalance.toLocaleString()} ETB
                </p>
              </button>
            ))}
          </div>
        ) : null}

        {recentLoading && matches.length === 0 ? (
          <p className="mt-4 text-sm text-slate-400">Loading users from database…</p>
        ) : null}

        {!recentLoading && !query.trim() && matches.length === 0 && !searchError ? (
          <p className="mt-4 text-sm text-slate-400">
            No registered users yet. Users are saved when they tap /start in the
            Telegram bot or open the Mini App.
          </p>
        ) : null}
      </PanelCard>

      {selectedUser ? (
        <PanelCard title="User Details" subtitle="Review account and add funds">
          <UserBalanceCard
            user={selectedUser}
            loading={addLoading}
            message={addMessage}
            onAddMoney={handleAddMoney}
          />
        </PanelCard>
      ) : null}
    </div>
  );
}
