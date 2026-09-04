import { useCallback, useEffect, useRef, useState } from 'react';
import PanelCard from '../components/PanelCard';
import type { ManualDepositRow, ManualDepositsResponse, ManualDepositStatus } from '../types';
import {
  approveManualDeposit,
  CONNECTING_MESSAGE,
  fetchManualDeposits,
  fetchManualDepositScreenshot,
  fetchManualDepositSettings,
  fetchWithStartupRetry,
  getApiErrorMessage,
  rejectManualDeposit,
  updateManualDepositSettings,
} from '../services/api';

type StatusFilter = 'all' | ManualDepositStatus;

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
];

function statusBadgeClass(status: ManualDepositStatus) {
  if (status === 'pending') {
    return 'border-amber-400/25 bg-amber-500/10 text-amber-200';
  }
  if (status === 'approved') {
    return 'border-emerald-400/25 bg-emerald-500/10 text-emerald-200';
  }
  return 'border-red-400/25 bg-red-500/10 text-red-200';
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '—';
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

function formatAmount(value: number | null | undefined) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  return `${Number(value)} ETB`;
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

function ScreenshotPreview({
  requestId,
  onOpen,
}: {
  requestId: string;
  onOpen: (src: string) => void;
}) {
  const [src, setSrc] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    let objectUrl = '';

    fetchManualDepositScreenshot(requestId)
      .then((blob) => {
        if (cancelled) return;
        if (!blob || blob.type.includes('json')) {
          setError('Screenshot unavailable');
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('[admin] manual deposit screenshot failed', err);
        setError('Screenshot unavailable');
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [requestId]);

  if (error) {
    return <p className="text-xs text-red-300">{error}</p>;
  }

  if (!src) {
    return <p className="text-xs text-slate-500">Loading screenshot…</p>;
  }

  return (
    <button
      type="button"
      onClick={() => onOpen(src)}
      className="block overflow-hidden rounded-lg border border-white/10 bg-black/40"
    >
      <img
        src={src}
        alt="Payment receipt"
        className="max-h-56 w-full object-contain"
      />
      <span className="block px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
        Click to enlarge
      </span>
    </button>
  );
}

function RequestRow({
  row,
  busyId,
  amountDraft,
  onAmountChange,
  onApprove,
  onReject,
  onOpenScreenshot,
}: {
  row: ManualDepositRow;
  busyId: string | null;
  amountDraft: string;
  onAmountChange: (id: string, value: string) => void;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onOpenScreenshot: (src: string) => void;
}) {
  const isBusy = busyId === row.id;
  const username = row.telegramUsername
    ? `@${row.telegramUsername.replace(/^@/, '')}`
    : '—';

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-base font-bold tabular-nums text-white">
              {formatAmount(row.amount)}
            </p>
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${statusBadgeClass(row.status)}`}
            >
              {row.status}
            </span>
          </div>

          <div className="grid grid-cols-1 gap-1 text-xs text-slate-300 sm:grid-cols-2">
            <p>
              <span className="text-slate-500">Telegram ID:</span> {row.userId}
            </p>
            <p>
              <span className="text-slate-500">Username:</span> {username}
            </p>
            <p>
              <span className="text-slate-500">Name:</span>{' '}
              {row.displayName || '—'}
            </p>
            <p>
              <span className="text-slate-500">Submitted amount:</span>{' '}
              {formatAmount(row.submittedAmount)}
            </p>
            <p className="sm:col-span-2">
              <span className="text-slate-500">Submitted:</span>{' '}
              {formatDateTime(row.createdAt)}
            </p>
            {row.reviewedAt ? (
              <p className="sm:col-span-2">
                <span className="text-slate-500">Reviewed:</span>{' '}
                {formatDateTime(row.reviewedAt)}
                {row.reviewedByTelegramId
                  ? ` by ${row.reviewedByTelegramId}`
                  : ''}
                {row.reviewedByRole ? ` (${row.reviewedByRole})` : ''}
              </p>
            ) : null}
          </div>

          {row.status === 'pending' ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <label className="block min-w-[10rem] text-xs text-slate-400">
                Verified amount (ETB)
                <input
                  type="number"
                  min="1"
                  step="0.01"
                  value={amountDraft}
                  onChange={(event) => onAmountChange(row.id, event.target.value)}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm font-semibold text-white outline-none focus:border-indigo-400/40"
                />
              </label>
              <div className="flex items-center gap-2">
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
            </div>
          ) : null}
        </div>

        <div className="w-full shrink-0 lg:w-64">
          <ScreenshotPreview requestId={row.id} onOpen={onOpenScreenshot} />
        </div>
      </div>
    </div>
  );
}

export default function ManualDepositsPage() {
  const [filter, setFilter] = useState<StatusFilter>('pending');
  const [requests, setRequests] = useState<ManualDepositRow[]>([]);
  const [stats, setStats] = useState({
    pending: 0,
    approved: 0,
    rejected: 0,
    total: 0,
  });
  const [amountDrafts, setAmountDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [lightboxSrc, setLightboxSrc] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState('');
  const initialLoadRef = useRef(true);

  const applyPayload = useCallback((payload: ManualDepositsResponse) => {
    const rows = payload.requests ?? [];
    setRequests(rows);
    if (payload.stats) setStats(payload.stats);
    setAmountDrafts((prev) => {
      const next = { ...prev };
      for (const row of rows) {
        if (next[row.id] == null) {
          next[row.id] =
            row.submittedAmount != null ? String(row.submittedAmount) : '';
        }
      }
      return next;
    });
  }, []);

  const loadRequests = useCallback(
    async (status: StatusFilter, useStartupRetry = false) => {
      setLoading(true);
      setError('');
      try {
        const fetchFn = () =>
          fetchManualDeposits(status === 'all' ? undefined : status);
        const data = useStartupRetry
          ? await fetchWithStartupRetry(fetchFn)
          : await fetchFn();
        applyPayload(data);
      } catch (err) {
        console.error('[admin] manual deposits fetch failed', err);
        setError(getApiErrorMessage(err, 'Failed to load manual deposits.'));
      } finally {
        setLoading(false);
      }
    },
    [applyPayload]
  );

  useEffect(() => {
    let cancelled = false;
    const useStartupRetry = initialLoadRef.current;
    initialLoadRef.current = false;

    loadRequests(filter, useStartupRetry).then(() => {
      if (cancelled) return;
    });

    return () => {
      cancelled = true;
    };
  }, [filter, loadRequests]);

  useEffect(() => {
    let cancelled = false;
    setSettingsLoading(true);
    fetchManualDepositSettings()
      .then((data) => {
        if (cancelled) return;
        setEnabled(Boolean(data.manualDepositEnabled));
      })
      .catch((err) => {
        if (cancelled) return;
        setError(getApiErrorMessage(err, 'Failed to load Manual Deposit setting.'));
      })
      .finally(() => {
        if (!cancelled) setSettingsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleToggleEnabled = async (next: boolean) => {
    const previous = enabled;
    setEnabled(next);
    setSettingsSaving(true);
    setSettingsMessage('');
    setError('');
    try {
      const data = await updateManualDepositSettings({ manualDepositEnabled: next });
      setEnabled(Boolean(data.manualDepositEnabled));
      setSettingsMessage(
        data.manualDepositEnabled
          ? 'Manual Deposit is ON. Users can submit requests from the Telegram bot.'
          : 'Manual Deposit is OFF. Automatic deposit is unchanged.'
      );
    } catch (err) {
      setEnabled(previous);
      setError(getApiErrorMessage(err, 'Failed to update Manual Deposit setting.'));
    } finally {
      setSettingsSaving(false);
    }
  };

  const handleApprove = async (id: string) => {
    const amount = Number(String(amountDrafts[id] || '').trim());
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Enter the verified amount before approving.');
      return;
    }

    setBusyId(id);
    setError('');
    setLightboxSrc('');
    try {
      await approveManualDeposit(id, amount);
      await loadRequests(filter);
    } catch (err) {
      console.error('[admin] manual deposit approve failed', err);
      setError(getApiErrorMessage(err, 'Approve failed.'));
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async (id: string) => {
    setBusyId(id);
    setError('');
    setLightboxSrc('');
    try {
      await rejectManualDeposit(id);
      await loadRequests(filter);
    } catch (err) {
      console.error('[admin] manual deposit reject failed', err);
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
      <PanelCard
        title="Manual Deposit availability"
        subtitle="ON/OFF for Telegram bot Manual Deposit only — automatic Telebirr/CBE deposits stay unchanged"
      >
        {settingsLoading ? (
          <p className="text-sm text-slate-400">Loading setting…</p>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-white">Manual Deposit</p>
              <p className="text-xs text-slate-400">
                When OFF, the bot hides Manual Deposit and rejects new requests. Pending
                approvals still work.
              </p>
            </div>
            <label className="flex cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={enabled}
                disabled={settingsSaving}
                onChange={(event) => {
                  void handleToggleEnabled(event.target.checked);
                }}
              />
              <span className="text-sm font-bold text-white">
                {enabled ? 'ON' : 'OFF'}
              </span>
            </label>
          </div>
        )}
        {settingsMessage ? (
          <p className="mt-3 text-sm text-emerald-300">{settingsMessage}</p>
        ) : null}
      </PanelCard>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatPill label="Pending" value={stats.pending} />
        <StatPill label="Approved" value={stats.approved} />
        <StatPill label="Rejected" value={stats.rejected} />
        <StatPill label="Total" value={stats.total} />
      </div>

      <PanelCard
        title="Manual Deposits"
        subtitle="Review Telegram bot screenshot deposits — wallet is credited only after Approve"
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
          <p className="text-sm text-slate-400">{CONNECTING_MESSAGE}</p>
        ) : visibleRequests.length === 0 ? (
          <p className="text-sm text-slate-400">
            No {filter === 'all' ? '' : `${filter} `}manual deposits yet.
          </p>
        ) : (
          <div className="space-y-3">
            {visibleRequests.map((row) => (
              <RequestRow
                key={row.id}
                row={row}
                busyId={busyId}
                amountDraft={amountDrafts[row.id] ?? ''}
                onAmountChange={(id, value) =>
                  setAmountDrafts((prev) => ({ ...prev, [id]: value }))
                }
                onApprove={handleApprove}
                onReject={handleReject}
                onOpenScreenshot={setLightboxSrc}
              />
            ))}
          </div>
        )}
      </PanelCard>

      {lightboxSrc ? (
        <button
          type="button"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
          onClick={() => setLightboxSrc('')}
        >
          <img
            src={lightboxSrc}
            alt="Payment receipt enlarged"
            className="max-h-full max-w-full rounded-xl object-contain shadow-2xl"
          />
        </button>
      ) : null}
    </div>
  );
}
