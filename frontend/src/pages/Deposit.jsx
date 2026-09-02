import { useEffect, useMemo, useState } from 'react';
import Navbar from '../components/Navbar';
import { fetchDepositMethods, submitDeposit } from '../api/deposit';

const PROVIDERS = [
  { id: 'telebirr', label: '🔴 Telebirr' },
  { id: 'cbe', label: '🔴 CBEBirr' },
];

function cbeDisplayAccount(cbe) {
  return cbe?.number || cbe?.account || '';
}

export default function Deposit({ activeScreen, onNavigate }) {
  const [methods, setMethods] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [provider, setProvider] = useState('telebirr');
  const [receivingNumber, setReceivingNumber] = useState('');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetchDepositMethods()
      .then((loaded) => {
        if (cancelled) return;
        setMethods(loaded);
        const first = loaded?.telebirr?.accounts?.[0]?.number || '';
        setReceivingNumber(first);
        if (!loaded?.telebirr?.enabled && loaded?.cbe?.enabled) {
          setProvider('cbe');
        }
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err.message || 'Could not load deposit methods');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const telebirrAccounts = methods?.telebirr?.accounts || [];
  const cbe = methods?.cbe;
  const cbeAccount = cbeDisplayAccount(cbe);

  const payTo = useMemo(() => {
    if (provider === 'cbe') {
      return {
        name: cbe?.receiverName || '—',
        number: cbeAccount || '—',
        account: cbe?.account || '',
      };
    }
    const selected =
      telebirrAccounts.find((account) => account.number === receivingNumber) ||
      telebirrAccounts[0];
    return {
      name: selected?.receiverName || '—',
      number: selected?.number || '—',
      account: '',
    };
  }, [provider, cbe, cbeAccount, telebirrAccounts, receivingNumber]);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setSuccess(null);

    if (!String(reference).trim()) {
      setError(
        provider === 'cbe'
          ? 'Paste the CBEBirr SMS confirmation.'
          : 'Enter the transaction / reference number.'
      );
      return;
    }

    if (provider === 'telebirr') {
      const parsedAmount = Number(String(amount).replace(/,/g, '').trim());
      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        setError('Enter a valid amount.');
        return;
      }
      if (!receivingNumber) {
        setError('Select a Telebirr receiving number.');
        return;
      }
    }

    if (provider === 'cbe' && !cbe?.enabled) {
      setError('CBEBirr deposits are not configured.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await submitDeposit({
        provider,
        receivingNumber: provider === 'telebirr' ? receivingNumber : cbeAccount,
        reference: String(reference).trim(),
        amount: provider === 'cbe' ? undefined : Number(String(amount).replace(/,/g, '').trim()),
      });
      setSuccess(result);
      setReference('');
    } catch (err) {
      setError(err.message || 'Deposit verification failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative flex h-[100dvh] max-h-[100dvh] w-full max-w-[100vw] flex-col overflow-hidden bg-[#0a0b14] font-sans text-white">
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <div className="absolute -left-10 top-0 h-48 w-48 rounded-full bg-violet-900/20 blur-[80px]" />
        <div className="absolute right-0 top-24 h-40 w-40 rounded-full bg-emerald-900/15 blur-[70px]" />
      </div>

      <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pt-3 sm:px-4 sm:pt-4">
        <header className="mb-3 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">
              Wallet
            </p>
            <h1 className="text-sm font-bold uppercase tracking-[0.14em] text-white">
              Deposit
            </h1>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('wallet')}
            className="rounded-full border border-white/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-300"
          >
            Back
          </button>
        </header>

        {loadError ? (
          <p className="rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {loadError}
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3 pb-4">
            <section className="rounded-2xl border border-white/[0.08] bg-[#1c1c1e] p-3">
              <p className="mb-1 text-sm font-bold text-white">💳 Deposit / Top-Up</p>
              <p className="mb-3 text-sm text-slate-300">
                Please choose your preferred payment method below:
              </p>
              <div className="grid grid-cols-2 gap-2">
                {PROVIDERS.map((item) => {
                  const active = provider === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setProvider(item.id);
                        setError('');
                        setSuccess(null);
                        setReference('');
                      }}
                      className={`rounded-xl px-3 py-2.5 text-sm font-semibold ${
                        active
                          ? 'bg-[#2c2c2e] text-white'
                          : 'bg-[#2c2c2e]/70 text-slate-200'
                      }`}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </section>

            {provider === 'telebirr' ? (
              <>
                <label className="block rounded-2xl border border-white/[0.08] bg-[#12151f] p-3">
                  <span className="mb-2 block text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                    Telebirr receiving number
                  </span>
                  <select
                    value={receivingNumber}
                    onChange={(event) => setReceivingNumber(event.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-[#0a0b14] px-3 py-2.5 text-sm text-white outline-none"
                  >
                    {telebirrAccounts.map((account) => (
                      <option key={account.number} value={account.number}>
                        {account.number} — {account.receiverName}
                      </option>
                    ))}
                  </select>
                </label>

                <section className="rounded-2xl border border-emerald-400/15 bg-emerald-500/5 px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-300">
                    Pay to
                  </p>
                  <p className="mt-1 text-sm font-semibold text-white">{payTo.name}</p>
                  <p className="text-sm tabular-nums text-slate-300">{payTo.number}</p>
                </section>

                <label className="block">
                  <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                    Amount (ETB)
                  </span>
                  <input
                    inputMode="decimal"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    placeholder="500"
                    className="w-full rounded-xl border border-white/10 bg-[#12151f] px-3 py-2.5 text-sm text-white outline-none"
                  />
                </label>

                <label className="block">
                  <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                    Transaction / reference number
                  </span>
                  <input
                    value={reference}
                    onChange={(event) => setReference(event.target.value)}
                    placeholder="Enter the payment reference"
                    className="w-full rounded-xl border border-white/10 bg-[#12151f] px-3 py-2.5 text-sm text-white outline-none"
                  />
                </label>
              </>
            ) : (
              <>
                <section className="rounded-2xl bg-[#1c1c1e] px-4 py-3 text-sm leading-relaxed text-white">
                  {cbe?.enabled ? (
                    <>
                      <p className="font-bold">🏦 CBEBirr Deposit</p>
                      <p className="mt-1">
                        Account: <span className="tabular-nums">{cbeAccount}</span>
                      </p>
                      {cbe?.receiverName ? (
                        <p>Name: {cbe.receiverName}</p>
                      ) : null}
                      <p className="mt-3 font-bold">📱 CBEBirr Deposit Steps</p>
                      <p className="mt-1">1️⃣ ከላይ ባለው የ CBEBirr አካውንት ገንዘቡን ያስገቡ።</p>
                      <p>2️⃣ ክፍያ ካደረጉ በኋላ የ CBEBirr የጽሁፍ መልእክት (SMS) ይደርስዎታል፡፡</p>
                      <p>3️⃣ የደረሳችሁን SMS ሙሉ በሙሉ ኮፒ በማድረግ በዚህ ቻት ፔስት አድርጉ፡፡</p>
                      <p className="mt-3">💬 የክፍያ ችግር ካለ፣ @Edil_bingo ይጠቀሙ፡፡</p>
                      <p className="mt-3 text-slate-400">------------------------------</p>
                      <p className="mt-2">
                        📩 After sending payment, please paste the SMS confirmation below 👇
                      </p>
                      <p className="text-slate-300">You can paste multiple times if needed.</p>
                    </>
                  ) : (
                    <p className="text-rose-200">CBEBirr deposits are not configured.</p>
                  )}
                </section>

                {cbe?.enabled ? (
                  <label className="block">
                    <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                      CBEBirr SMS
                    </span>
                    <textarea
                      value={reference}
                      onChange={(event) => setReference(event.target.value)}
                      placeholder="Paste the CBEBirr SMS confirmation"
                      rows={5}
                      className="w-full rounded-xl border border-white/10 bg-[#12151f] px-3 py-2.5 text-sm text-white outline-none"
                    />
                  </label>
                ) : null}
              </>
            )}

            {error ? (
              <p className="rounded-xl border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                {error}
              </p>
            ) : null}

            {success ? (
              <p className="rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
                Deposit verified. Play wallet: {success.playWallet ?? success.verifiedAmount} ETB
              </p>
            ) : null}

            {provider === 'telebirr' || cbe?.enabled ? (
              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-xl bg-emerald-500 py-3 text-sm font-bold uppercase tracking-[0.16em] text-emerald-950 disabled:opacity-60"
              >
                {submitting ? 'Verifying…' : provider === 'cbe' ? 'Submit SMS' : 'Submit deposit'}
              </button>
            ) : null}
          </form>
        )}
      </div>

      <div
        className="shrink-0 h-[calc(2.75rem+env(safe-area-inset-bottom,0px))] sm:h-[3rem]"
        aria-hidden="true"
      />
      <Navbar activeScreen={activeScreen === 'deposit' ? 'wallet' : activeScreen} onNavigate={onNavigate} embedded />
    </div>
  );
}
