import { useCallback, useEffect, useState } from 'react';
import PanelCard from '../components/PanelCard';
import {
  fetchRegistrationBonusSettings,
  getApiErrorMessage,
  updateRegistrationBonusSettings,
} from '../services/api';
import type { RegistrationBonusSettings } from '../types';

function clampAmount(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.floor(value)));
}

export default function RegistrationBonusPage() {
  const [settings, setSettings] = useState<RegistrationBonusSettings | null>(null);
  const [enabledDraft, setEnabledDraft] = useState(false);
  const [amountDraft, setAmountDraft] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const minAmount = settings?.minAmount ?? 0;
  const maxAmount = settings?.maxAmount ?? 100000;

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchRegistrationBonusSettings();
      setSettings(data);
      setEnabledDraft(Boolean(data.registrationBonusEnabled));
      setAmountDraft(
        clampAmount(Number(data.registrationBonusAmount) || 0, data.minAmount, data.maxAmount)
      );
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not load registration bonus settings.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const onSave = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const data = await updateRegistrationBonusSettings({
        registrationBonusEnabled: enabledDraft,
        registrationBonusAmount: clampAmount(amountDraft, minAmount, maxAmount),
      });
      setSettings(data);
      setEnabledDraft(Boolean(data.registrationBonusEnabled));
      setAmountDraft(
        clampAmount(Number(data.registrationBonusAmount) || 0, data.minAmount, data.maxAmount)
      );
      setMessage('Registration bonus settings saved.');
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not save registration bonus settings.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-white">Registration Bonus</h1>
        <p className="mt-1 text-sm text-slate-400">
          Credit new Telegram bot registrations with a one-time play wallet bonus.
        </p>
      </div>

      <PanelCard
        title="Registration Bonus"
        subtitle="Automatically credit play wallet when a new user completes bot registration"
      >
        {loading ? (
          <p className="text-sm text-slate-400">Loading settings…</p>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-white">Enable Registration Bonus</p>
                <p className="text-xs text-slate-400">
                  When ON, new users receive the configured bonus once.
                </p>
              </div>
              <label className="flex cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  checked={enabledDraft}
                  onChange={(e) => {
                    setEnabledDraft(e.target.checked);
                    setMessage(null);
                  }}
                />
                <span className="text-sm font-bold text-white">
                  {enabledDraft ? 'ON' : 'OFF'}
                </span>
              </label>
            </div>

            <label className="block rounded-xl border border-white/10 bg-white/5 p-3">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Bonus Amount (Birr)
              </span>
              <input
                className="mt-2 w-full bg-transparent text-lg font-bold text-white outline-none"
                type="number"
                min={minAmount}
                max={maxAmount}
                step={1}
                value={amountDraft}
                onChange={(e) => {
                  const parsed = Number(e.target.value);
                  if (!Number.isFinite(parsed)) return;
                  setAmountDraft(clampAmount(parsed, minAmount, maxAmount));
                  setMessage(null);
                }}
              />
              <p className="mt-2 text-xs text-slate-400">
                Examples: 10, 15, 20 Birr. Credited to Play Wallet on first registration only.
              </p>
            </label>

            {error ? (
              <p className="text-sm text-rose-300">{error}</p>
            ) : null}
            {message ? (
              <p className="text-sm text-emerald-300">{message}</p>
            ) : null}

            <button
              type="button"
              onClick={onSave}
              disabled={saving}
              className="rounded-xl border border-indigo-400/30 bg-indigo-500/20 px-4 py-2 text-sm font-bold text-indigo-100 transition hover:bg-indigo-500/30 disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save Settings'}
            </button>
          </div>
        )}
      </PanelCard>
    </div>
  );
}
