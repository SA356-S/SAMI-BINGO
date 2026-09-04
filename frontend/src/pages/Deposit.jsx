import { useEffect, useMemo, useState } from 'react';
import Navbar from '../components/Navbar';
import { fetchDepositMethods, submitDeposit } from '../api/deposit';

const MIN_DEPOSIT_AMOUNT = 10;
const MIN_DEPOSIT_MESSAGE = 'Minimum deposit amount is 10 ETB.';
const AMOUNT_PROMPT =
  '💰 የተቀማጭ ገንዘብ መጠን በ ETB ያስገቡ (ቁጥር ብቻ)። ለምሳሌ፡ 10';

function displayFirstName(fullName) {
  const text = String(fullName ?? '').trim();
  if (!text) return '';
  return text.split(/\s+/)[0];
}

function cbeDisplayAccount(cbe) {
  return cbe?.number || cbe?.account || '';
}

function parseAmount(value) {
  const amount = Number(String(value ?? '').replace(/,/g, '').trim());
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return Math.round(amount * 100) / 100;
}

export default function Deposit({ activeScreen, onNavigate }) {
  const [methods, setMethods] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [step, setStep] = useState('topup');
  const [provider, setProvider] = useState('');
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
  const parsedAmount = parseAmount(amount);
  const selectedAmount = parsedAmount ?? MIN_DEPOSIT_AMOUNT;

  const payTo = useMemo(() => {
    if (provider === 'cbe') {
      return {
        name: displayFirstName(cbe?.receiverName) || '—',
        number: cbeAccount || '—',
      };
    }
    const selected =
      telebirrAccounts.find((account) => account.number === receivingNumber) ||
      telebirrAccounts[0];
    return {
      name: displayFirstName(selected?.receiverName) || '—',
      number: selected?.number || '—',
    };
  }, [provider, cbe, cbeAccount, telebirrAccounts, receivingNumber]);

  function goBack() {
    setError('');
    setSuccess(null);
    if (step === 'pay') {
      setProvider('');
      setReference('');
      setStep('method');
      return;
    }
    if (step === 'method') {
      setStep('topup');
      return;
    }
    onNavigate('wallet');
  }

  function continueFromTopUp() {
    setError('');
    setSuccess(null);
    if (parsedAmount == null) {
      setError('Enter a valid amount.');
      return;
    }
    if (parsedAmount < MIN_DEPOSIT_AMOUNT) {
      setError(MIN_DEPOSIT_MESSAGE);
      return;
    }
    setStep('method');
  }

  function chooseProvider(nextProvider) {
    setError('');
    setSuccess(null);
    setReference('');
    setProvider(nextProvider);
    if (nextProvider === 'telebirr' && !receivingNumber) {
      setReceivingNumber(telebirrAccounts[0]?.number || '');
    }
    setStep('pay');
  }

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
      if (parsedAmount == null) {
        setError('Enter a valid amount.');
        return;
      }
      if (parsedAmount < MIN_DEPOSIT_AMOUNT) {
        setError(MIN_DEPOSIT_MESSAGE);
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
        amount: provider === 'cbe' ? undefined : parsedAmount,
      });
      setSuccess(result);
      setReference('');
    } catch (err) {
      setError(err.message || 'Deposit verification failed');
    } finally {
      setSubmitting(false);
    }
  }

  const enabledProviders = [
    methods?.telebirr?.enabled
      ? { id: 'telebirr', label: 'Telebirr' }
      : null,
    methods?.cbe?.enabled ? { id: 'cbe', label: 'CBE Birr' } : null,
  ].filter(Boolean);

  return (
    <div className="relative flex h-[100dvh] max-h-[100dvh] w-full max-w-[100vw] flex-col overflow-hidden bg-[#0a0b14] font-sans text-white">
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <div className="absolute -left-10 top-0 h-48 w-48 rounded-full bg-emerald-900/20 blur-[80px]" />
        <div className="absolute right-0 top-24 h-40 w-40 rounded-full bg-violet-900/15 blur-[70px]" />
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
            onClick={goBack}
            className="rounded-full border border-white/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-300"
          >
            Back
          </button>
        </header>

        {loadError ? (
          <p className="rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {loadError}
          </p>
        ) : step === 'topup' ? (
          <section className="space-y-4 pb-4">
            <div className="rounded-2xl border border-white/[0.08] bg-[#1c1c1e] px-4 py-4">
              <p className="text-[15px] leading-relaxed text-white">{AMOUNT_PROMPT}</p>
            </div>

            <label className="block">
              <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                Amount (ETB)
              </span>
              <input
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="10"
                className="w-full rounded-xl border border-white/10 bg-[#12151f] px-3 py-2.5 text-sm text-white outline-none"
              />
            </label>

            {error ? (
              <p className="rounded-xl border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                {error}
              </p>
            ) : null}

            <button
              type="button"
              onClick={continueFromTopUp}
              className="w-full rounded-xl bg-emerald-500 py-3 text-sm font-bold uppercase tracking-[0.16em] text-emerald-950"
            >
              Continue
            </button>
          </section>
        ) : step === 'method' ? (
          <section className="space-y-4 pb-4">
            <p className="text-center text-sm font-semibold tabular-nums text-emerald-200">
              መጠን: {selectedAmount} ETB
            </p>
            <p className="text-center text-base font-bold text-white">
              የክፍያ አማራጭ ይምረጡ፦
            </p>
            <div className="space-y-2">
              {enabledProviders.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => chooseProvider(item.id)}
                  className="w-full rounded-2xl border border-white/10 bg-[#1c1c1e] px-4 py-3.5 text-left text-sm font-semibold text-white"
                >
                  {item.label}
                </button>
              ))}
            </div>
            {enabledProviders.length === 0 ? (
              <p className="rounded-xl border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                Deposit methods are not configured.
              </p>
            ) : null}
          </section>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3 pb-4">
            <p className="text-center text-sm font-semibold tabular-nums text-emerald-200">
              መጠን: {selectedAmount} ETB
            </p>

            {provider === 'telebirr' ? (
              <>
                <section className="rounded-2xl bg-[#1c1c1e] px-4 py-3 text-sm leading-relaxed text-white">
                  <p className="font-bold">🏦 Telebirr Deposit</p>
                  {payTo.name ? <p className="mt-1">Name: {payTo.name}</p> : null}
                  <p>
                    Phone: <span className="tabular-nums">{payTo.number}</span>
                  </p>
                  <p className="mt-3 font-bold">📱 Telebirr Deposit Steps</p>
                  <p className="mt-1">1️⃣ ከላይ ባለው የ Telebirr አካውንት ገንዘቡን ያስገቡ።</p>
                  <p>2️⃣ ክፍያ ካደረጉ በኋላ የ Telebirr የጽሁፍ መልእክት (SMS) ይደርስዎታል፡፡</p>
                  <p>3️⃣ የደረሳችሁን SMS ሙሉ በሙሉ ኮፒ በማድረግ በዚህ ቻት ፔስት አድርጉ፡፡</p>
                  <p className="mt-3">💬 የክፍያ ችግር ካለ፣ @Capital_bingoo ይጠቀሙ፡፡</p>
                  <p className="mt-3 text-slate-400">------------------------------</p>
                  <p className="mt-2">
                    📩 After sending payment, paste the SMS confirmation or only the
                    transaction / reference number below 👇
                  </p>
                  <p className="text-slate-300">You can paste multiple times if needed.</p>
                </section>

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
                        <p>Name: {displayFirstName(cbe.receiverName)}</p>
                      ) : null}
                      <p className="mt-3 font-bold">📱 CBEBirr Deposit Steps</p>
                      <p className="mt-1">1️⃣ ከላይ ባለው የ CBEBirr አካውንት ገንዘቡን ያስገቡ።</p>
                      <p>2️⃣ ክፍያ ካደረጉ በኋላ የ CBEBirr የጽሁፍ መልእክት (SMS) ይደርስዎታል፡፡</p>
                      <p>3️⃣ የደረሳችሁን SMS ሙሉ በሙሉ ኮፒ በማድረግ በዚህ ቻት ፔስት አድርጉ፡፡</p>
                      <p className="mt-3">💬 የክፍያ ችግር ካለ፣ @Capital_bingoo ይጠቀሙ፡፡</p>
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
