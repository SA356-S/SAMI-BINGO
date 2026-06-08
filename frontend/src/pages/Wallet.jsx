import { useCallback, useEffect, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import ScreenLayout from '../components/ScreenLayout';
import { fetchWalletPage, subscribeWalletPage } from '../api/wallet';
import { getPlayerUserId } from '../api/playerIdentity';

function TransactionRow({ item }) {
  const isWithdraw = item.type === 'withdraw';

  return (
    <li className="flex items-start gap-3 rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 py-3">
      <span
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
          isWithdraw ? 'bg-orange-500/15' : 'bg-emerald-500/15'
        }`}
      >
        {isWithdraw ? (
          <ArrowUpRight className="h-5 w-5 text-orange-400" strokeWidth={2} />
        ) : (
          <ArrowDownLeft className="h-5 w-5 text-emerald-400" strokeWidth={2} />
        )}
      </span>

      <div className="min-w-0 flex-1">
        <p
          className={`text-xs font-bold tracking-wide ${
            isWithdraw ? 'text-orange-400' : 'text-emerald-400'
          }`}
        >
          {item.title}
        </p>
        <p className="mt-1 text-[11px] font-medium text-white/60">
          {item.detail}
        </p>
        <p className="mt-0.5 text-[10px] text-white/40">{item.date}</p>
      </div>

      <p
        className={`shrink-0 pt-0.5 text-sm font-bold tabular-nums ${
          isWithdraw ? 'text-orange-400' : 'text-emerald-400'
        }`}
      >
        {isWithdraw ? '' : '+'}
        {item.amount} ETB
      </p>
    </li>
  );
}

export default function Wallet({ activeScreen, onNavigate }) {
  const [transactions, setTransactions] = useState([]);
  const [phone, setPhone] = useState('');
  const [verified, setVerified] = useState(false);
  const [loading, setLoading] = useState(true);

  const applyPage = useCallback((page) => {
    setTransactions(page.transactions);
    setPhone(page.phone ?? '');
    setVerified(page.verified === true);
    setLoading(false);
  }, []);

  const refreshWallet = useCallback(() => {
    const userId = getPlayerUserId();
    return fetchWalletPage(userId).then(applyPage);
  }, [applyPage]);

  useEffect(() => {
    let cancelled = false;

    const userId = getPlayerUserId();
    fetchWalletPage(userId).then((page) => {
      if (!cancelled) applyPage(page);
    });

    const unsubscribe = subscribeWalletPage(userId, (page) => {
      if (!cancelled) applyPage(page);
    });

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        refreshWallet();
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      unsubscribe();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [applyPage, refreshWallet]);

  return (
    <ScreenLayout
      activeScreen={activeScreen}
      onNavigate={onNavigate}
      contentVariant="fill"
      headerPhone={phone}
      headerVerified={verified}
    >
      <div className="flex min-h-0 w-full flex-1 flex-col gap-3 overflow-hidden">
        {/* Recent activity */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <p className="mb-2 shrink-0 text-[10px] font-semibold tracking-[0.2em] text-white/45">
            RECENT ACTIVITY
          </p>
          {loading ? (
            <p className="py-6 text-center text-sm text-white/35">
              Loading activity…
            </p>
          ) : transactions.length === 0 ? (
            <p className="py-6 text-center text-sm text-white/35">
              No transactions yet.
            </p>
          ) : (
            <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {transactions.map((item) => (
                <TransactionRow key={item.id} item={item} />
              ))}
            </ul>
          )}
        </div>

        {/* Footer note */}
        <p className="shrink-0 pb-1 text-center text-[9px] leading-snug tracking-wide text-white/30">
          MANAGE YOUR FUNDS IN THE TELEGRAM BOT CHAT
        </p>
      </div>
    </ScreenLayout>
  );
}
