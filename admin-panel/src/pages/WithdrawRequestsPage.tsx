import { useCallback, useEffect, useState } from 'react';
import PanelCard from '../components/PanelCard';
import type { WithdrawRequestRow, WithdrawRequestsResponse } from '../types';
import {
  approveWithdrawRequest,
  fetchWithdrawRequests,
  getApiErrorMessage,
  rejectWithdrawRequest,
} from '../services/api';
import { subscribeWithdrawRequests } from '../services/socket';

type StatusFilter = 'all' | 'pending' | 'approved' | 'rejected';

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
];

function statusBadgeClass(status: WithdrawRequestRow['status']) {
  if (status === 'pending') {
    return 'border-amber-400/25 bg-amber-500/10 text-amber-200';
  }
  if (status === 'approved') {
    return 'border-emerald-400/25 bg-emerald-500/10 text-emerald-200';
  }
  return 'border-red-400/25 bg-red-500/10 text-red-200';
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function StatPill({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        {label}
      </p>
      <p className="mt-1 text-xl font-extrabold tabular-nums text-white">{value}</p>
    </div>
  );
}

function RequestRow({
  row,
  busyId,
  onApprove,
  onReject,
}: {
  row: WithdrawRequestRow;
  busyId: string | null;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const isBusy = busyId === row.id;
  const username = row.telegramUsername
    ? `@${row.telegramUsername.replace(/^@/, '')}`
    : '—';

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-base font-bold tabular-nums text-white">
              {row.amount} ETB
            </p>
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${statusBadgeClass(row.status)}`}
            >
              {row.status}
            </span>
          </div>

          <div className="grid grid-cols-1 gap-1 text-xs text-slate-300 sm:grid-cols-2">
            <p>
              <span className="text-slate-500">User ID:</span> {row.userId}
            </p>
            <p>
              <span className="text-slate-500">Telegram:</span> {username}
            </p>
            <p>
              <span className="text-slate-500">Method:</span>{' '}
              {row.paymentMethodLabel || row.paymentMethod}
            </p>
            <p>
              <span className="text-slate-500">Phone:</span> {row.phone || '—'}
            </p>
            <p className="sm:col-span-2">
              <span className="text-slate-500">Account owner:</span>{' '}
              {row.accountName || '—'}
            </p>
            <p className="sm:col-span-2">
              <span className="text-slate-500">Requested:</span>{' '}
              {formatDateTime(row.createdAt)}
            </p>
          </div>
        </div>

        {row.status === 'pending' ? (
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              disabled={isBusy}
              onClick={() => onApprove(row.id)}
              className="rounded-lg border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-xs font-bold text-emerald-200 transition hover:bg-emerald-500/20 disabled:opacity-50"
            >
              {isBusy ? '…' : '✅ Approve'}
            </button>
            <button
              type="button"
              disabled={isBusy}
              onClick={() => onReject(row.id)}
              className="rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs font-bold text-red-200 transition hover:bg-red-500/20 disabled:opacity-50"
            >
              {isBusy ? '…' : '❌ Reject'}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function WithdrawRequestsPage() {
  const [filter, setFilter] = useState<StatusFilter>('pending');
  const [requests, setRequests] = useState<WithdrawRequestRow[]>([]);
  const [stats, setStats] = useState({
    pending: 0,
    approved: 0,
    rejected: 0,
    total: 0,
  });
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const applyPayload = useCallback((payload: WithdrawRequestsResponse) => {
    setRequests(payload.requests ?? []);
    if (payload.stats) setStats(payload.stats);
  }, []);

  const loadRequests = useCallback(
    async (status: StatusFilter) => {
      setLoading(true);
      setError('');
      try {
        const data = await fetchWithdrawRequests(
          status === 'all' ? undefined : status
        );
        applyPayload(data);
      } catch (err) {
        console.error('[admin] withdraw requests fetch failed', err);
        setError(getApiErrorMessage(err, 'Failed to load withdraw requests.'));
      } finally {
        setLoading(false);
      }
    },
    [applyPayload]
  );

  useEffect(() => {
    let cancelled = false;

    loadRequests(filter).then(() => {
      if (cancelled) return;
    });

    const unsubscribe = subscribeWithdrawRequests((payload) => {
      if (cancelled) return;
      applyPayload(payload);
      setLoading(false);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [filter, loadRequests, applyPayload]);

  const handleApprove = async (id: string) => {
    setBusyId(id);
    setError('');
    try {
      await approveWithdrawRequest(id);
      await loadRequests(filter);
    } catch (err) {
      console.error('[admin] withdraw approve failed', err);
      setError(getApiErrorMessage(err, 'Approve failed.'));
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async (id: string) => {
    setBusyId(id);
    setError('');
    try {
      await rejectWithdrawRequest(id);
      await loadRequests(filter);
    } catch (err) {
      console.error('[admin] withdraw reject failed', err);
      setError(getApiErrorMessage(err, 'Reject failed.'));
    } finally {
      setBusyId(null);
    }
  };

  const visibleRequests =
    filter === 'all'
      ? requests
      : requests.filter((row) => row.status === filter);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatPill label="Pending" value={stats.pending} />
        <StatPill label="Approved" value={stats.approved} />
        <StatPill label="Rejected" value={stats.rejected} />
        <StatPill label="Total" value={stats.total} />
      </div>

      <PanelCard
        title="Withdraw Requests"
        subtitle="Review Telegram bot withdrawal requests — main wallet only"
      >
        <div className="mb-4 flex flex-wrap gap-2">
          {FILTERS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setFilter(item.key)}
              className={[
                'rounded-lg border px-3 py-2 text-xs font-bold transition',
                filter === item.key
                  ? 'border-indigo-400/30 bg-indigo-500/15 text-indigo-200'
                  : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10',
              ].join(' ')}
            >
              {item.label}
            </button>
          ))}
        </div>

        {error ? (
          <p className="mb-3 rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {error}
          </p>
        ) : null}

        {loading ? (
          <p className="text-sm text-slate-400">Loading withdraw requests…</p>
        ) : visibleRequests.length === 0 ? (
          <p className="text-sm text-slate-400">
            No {filter === 'all' ? '' : `${filter} `}withdraw requests yet.
          </p>
        ) : (
          <div className="space-y-3">
            {visibleRequests.map((row) => (
              <RequestRow
                key={row.id}
                row={row}
                busyId={busyId}
                onApprove={handleApprove}
                onReject={handleReject}
              />
            ))}
          </div>
        )}
      </PanelCard>
    </div>
  );
}
