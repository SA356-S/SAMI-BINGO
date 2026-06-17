import { ArrowDownLeft, ArrowUpRight } from 'lucide-react';

function formatActivityDate(value) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
  });
}

export default function WalletTransactionRow({ item }) {
  const isWithdraw = item.type === 'withdraw';
  const amount = Math.abs(Number(item.amount) || 0);
  const amountLabel = isWithdraw ? `-${amount}` : `+${amount}`;

  return (
    <li className="flex items-start gap-3 rounded-2xl border border-white/[0.07] bg-[#12151f] px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
      <span
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
          isWithdraw
            ? 'bg-orange-500/20 text-orange-300 shadow-[0_0_16px_rgba(249,115,22,0.18)]'
            : 'bg-emerald-500/20 text-emerald-300 shadow-[0_0_16px_rgba(16,185,129,0.18)]'
        }`}
      >
        {isWithdraw ? (
          <ArrowUpRight className="h-5 w-5" strokeWidth={2.25} />
        ) : (
          <ArrowDownLeft className="h-5 w-5" strokeWidth={2.25} />
        )}
      </span>

      <div className="min-w-0 flex-1 pt-0.5">
        <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-white">
          {item.title}
        </p>
        <p className="mt-1 text-[10px] font-medium text-slate-400">{item.detail}</p>
      </div>

      <div className="shrink-0 text-right">
        <p
          className={`text-sm font-bold tabular-nums ${
            isWithdraw ? 'text-orange-400' : 'text-emerald-400'
          }`}
        >
          {amountLabel} ETB
        </p>
        <p className="mt-1 text-[10px] font-medium text-slate-500">
          {formatActivityDate(item.date)}
        </p>
      </div>
    </li>
  );
}
