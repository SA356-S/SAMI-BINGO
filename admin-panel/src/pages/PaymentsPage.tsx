import { useEffect, useState } from 'react';
import PanelCard from '../components/PanelCard';
import type { PaymentRow } from '../types';
import { fetchPayments } from '../services/api';

function PaymentList({
  title,
  rows,
}: {
  title: string;
  rows: PaymentRow[];
}) {
  return (
    <div className="space-y-3">
      {rows.length === 0 ? (
        <p className="text-sm text-slate-400">No {title.toLowerCase()} yet.</p>
      ) : (
        rows.map((row) => (
          <div
            key={row.id}
            className="rounded-xl border border-white/10 bg-white/5 p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-white">
                  {row.amount} ETB • {row.channel}
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  Ref: {row.reference || '—'}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  User: {row.userId}
                </p>
              </div>
              <div className="shrink-0">
                <p className="text-xs font-bold text-indigo-300">Pending</p>
              </div>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                disabled
                className="rounded-lg border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-xs font-bold text-emerald-200 opacity-60"
              >
                Approve
              </button>
              <button
                type="button"
                disabled
                className="rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs font-bold text-red-200 opacity-60"
              >
                Reject
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

export default function PaymentsPage() {
  const [deposits, setDeposits] = useState<PaymentRow[]>([]);
  const [withdraws, setWithdraws] = useState<PaymentRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    fetchPayments()
      .then((res) => {
        if (cancelled) return;
        setDeposits(res.deposits ?? []);
        setWithdraws(res.withdraws ?? []);
      })
      .catch((err) => {
        console.error('[admin] payments fetch failed', err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <PanelCard
        title="Payments • Deposits"
        subtitle="UI only (approve/reject will connect later)"
      >
        {loading ? (
          <p className="text-sm text-slate-400">Loading deposits…</p>
        ) : (
          <PaymentList title="Deposits" rows={deposits} />
        )}
      </PanelCard>

      <PanelCard
        title="Payments • Withdraws"
        subtitle="UI only (approve/reject will connect later)"
      >
        {loading ? (
          <p className="text-sm text-slate-400">Loading withdraws…</p>
        ) : (
          <PaymentList title="Withdraws" rows={withdraws} />
        )}
      </PanelCard>
    </div>
  );
}

