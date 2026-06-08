import { FormEvent, useState } from 'react';
import { User, Phone, Wallet, AtSign } from 'lucide-react';
import type { AdminUserRow } from '../types';

interface UserBalanceCardProps {
  user: AdminUserRow;
  loading: boolean;
  message: { type: 'success' | 'error'; text: string } | null;
  onAddMoney: (amount: number) => void;
}

function formatMoney(value: number) {
  return `${value.toLocaleString()} ETB`;
}

export default function UserBalanceCard({
  user,
  loading,
  message,
  onAddMoney,
}: UserBalanceCardProps) {
  const [amount, setAmount] = useState('');

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) return;
    onAddMoney(value);
  };

  const parsedAmount = Number(amount);
  const amountInvalid =
    amount !== '' && (!Number.isFinite(parsedAmount) || parsedAmount <= 0);

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-3">
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-indigo-300" />
            <p className="text-lg font-bold text-white">{user.name}</p>
          </div>

          <div className="grid gap-2 text-sm text-slate-300 sm:grid-cols-2">
            <p className="inline-flex items-center gap-2">
              <AtSign className="h-4 w-4 text-slate-400" />
              <span>{user.username || 'No username'}</span>
            </p>
            <p className="inline-flex items-center gap-2">
              <Phone className="h-4 w-4 text-slate-400" />
              <span>{user.phone || 'No phone'}</span>
            </p>
          </div>

          <p className="text-xs text-slate-500">User ID: {user.userId}</p>
        </div>

        <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3">
          <p className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-emerald-200/80">
            <Wallet className="h-3.5 w-3.5" />
            Total Balance
          </p>
          <p className="mt-1 text-2xl font-extrabold tabular-nums text-emerald-100">
            {formatMoney(user.totalWalletBalance)}
          </p>
          <p className="mt-1 text-xs text-emerald-200/70">
            Play: {formatMoney(user.playWallet)} • Main:{' '}
            {formatMoney(user.mainWallet)}
          </p>
        </div>
      </div>

      <div className="mt-5 border-t border-white/10 pt-5">
        <h3 className="text-sm font-semibold text-white/90">Add Money</h3>
        <p className="mt-1 text-xs text-slate-400">
          Credits the user&apos;s play wallet immediately.
        </p>

        <form
          onSubmit={handleSubmit}
          className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-start"
        >
          <div className="min-w-0 flex-1">
            <label className="sr-only" htmlFor="add-amount">
              Amount in ETB
            </label>
            <input
              id="add-amount"
              type="number"
              min="1"
              step="1"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="Enter amount (ETB)"
              className="w-full rounded-xl border border-white/10 bg-[#0b0f1a] px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-emerald-400/40 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
            />
            {amountInvalid ? (
              <p className="mt-2 text-xs text-red-300">
                Enter a positive amount greater than zero.
              </p>
            ) : null}
          </div>

          <button
            type="submit"
            disabled={
              loading ||
              !amount.trim() ||
              amountInvalid ||
              !Number.isFinite(parsedAmount) ||
              parsedAmount <= 0
            }
            className="rounded-xl border border-emerald-400/30 bg-emerald-500/20 px-5 py-3 text-sm font-bold text-emerald-100 transition hover:bg-emerald-500/30 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? 'Adding…' : 'Add Money'}
          </button>
        </form>

        {message ? (
          <p
            className={[
              'mt-3 rounded-lg px-3 py-2 text-sm font-medium',
              message.type === 'success'
                ? 'border border-emerald-400/20 bg-emerald-500/10 text-emerald-200'
                : 'border border-red-400/20 bg-red-500/10 text-red-200',
            ].join(' ')}
          >
            {message.text}
          </p>
        ) : null}
      </div>
    </div>
  );
}
