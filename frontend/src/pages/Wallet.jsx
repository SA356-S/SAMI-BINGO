import { useCallback, useEffect, useState } from 'react';
import Navbar from '../components/Navbar';
import { fetchWalletPage, subscribeWalletPage } from '../api/wallet';
import { getPlayerUserId } from '../api/playerIdentity';
import WalletPageHeader from './wallet/WalletPageHeader';
import WalletBalanceSection from './wallet/WalletBalanceSection';
import WalletTransactionRow from './wallet/WalletTransactionRow';

export default function Wallet({ activeScreen, onNavigate }) {
  const [transactions, setTransactions] = useState([]);
  const [mainWallet, setMainWallet] = useState(0);
  const [playWallet, setPlayWallet] = useState(0);
  const [totalAvailable, setTotalAvailable] = useState(0);
  const [phone, setPhone] = useState('');
  const [verified, setVerified] = useState(false);
  const [loading, setLoading] = useState(true);

  const applyPage = useCallback((page) => {
    setTransactions(page.transactions);
    setMainWallet(page.mainWallet ?? 0);
    setPlayWallet(page.playWallet ?? 0);
    setTotalAvailable(page.totalAvailable ?? page.totalWalletBalance ?? 0);
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
    <div className="relative flex h-[100dvh] max-h-[100dvh] w-full max-w-[100vw] flex-col overflow-hidden bg-[#0a0b14] font-sans text-white">
      <div
        className="pointer-events-none absolute inset-0 overflow-hidden"
        aria-hidden
      >
        <div className="absolute -left-10 top-0 h-48 w-48 rounded-full bg-violet-900/20 blur-[80px]" />
        <div className="absolute right-0 top-24 h-40 w-40 rounded-full bg-emerald-900/15 blur-[70px]" />
      </div>

      <div className="relative z-10 flex min-h-0 flex-1 flex-col px-3 pt-3 sm:px-4 sm:pt-4">
        <WalletPageHeader phone={phone} verified={verified} />

        <WalletBalanceSection
          mainWallet={mainWallet}
          playWallet={playWallet}
          totalAvailable={totalAvailable}
          loading={loading}
          onDeposit={() => onNavigate('deposit')}
        />

        <section className="mt-4 flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="mb-2.5 flex shrink-0 items-center justify-between border-b border-white/[0.06] pb-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">
              RECENT ACTIVITY
            </p>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-violet-300">
              {loading ? '…' : `${transactions.length} TOTAL`}
            </p>
          </div>

          {loading ? (
            <p className="py-8 text-center text-sm font-medium text-slate-400">
              Loading activity…
            </p>
          ) : transactions.length === 0 ? (
            <p className="py-8 text-center text-sm font-medium text-slate-400">
              No transactions yet.
            </p>
          ) : (
            <ul className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto overscroll-contain pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {transactions.map((item) => (
                <WalletTransactionRow key={item.id} item={item} />
              ))}
            </ul>
          )}
        </section>

        <p className="shrink-0 py-2 text-center text-[9px] font-medium uppercase leading-snug tracking-[0.12em] text-slate-500">
          Deposits use Telebirr or CBE Birr and credit this wallet
        </p>
      </div>

      <div
        className="shrink-0 h-[calc(2.75rem+env(safe-area-inset-bottom,0px))] sm:h-[3rem]"
        aria-hidden="true"
      />

      <Navbar activeScreen={activeScreen} onNavigate={onNavigate} embedded />
    </div>
  );
}
