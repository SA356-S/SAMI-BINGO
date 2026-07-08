import { useCallback, useEffect, useState } from 'react';
import PanelCard from '../components/PanelCard';
import {
  fetchFirstDepositBonusSettings,
  getApiErrorMessage,
  updateFirstDepositBonusSettings,
} from '../services/api';
import type { FirstDepositBonusSettings } from '../types';

function normalizePercent(value: number) {
  if (!Number.isFinite(value) || value < 0) return 0;
  return value;
}

export default function FirstDepositBonusPage() {
  const [settings, setSettings] = useState<FirstDepositBonusSettings | null>(null);
  const [enabledDraft, setEnabledDraft] = useState(false);
  const [percentDraft, setPercentDraft] = useState(100);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchFirstDepositBonusSettings();
      setSettings(data);
      setEnabledDraft(Boolean(data.firstDepositBonusEnabled));
      setPercentDraft(normalizePercent(Number(data.firstDepositBonusPercent) || 0));
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not load first deposit bonus settings.'));
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
      const data = await updateFirstDepositBonusSettings({
        firstDepositBonusEnabled: enabledDraft,
        firstDepositBonusPercent: normalizePercent(percentDraft),
      });
      setSettings(data);
      setEnabledDraft(Boolean(data.firstDepositBonusEnabled));
      setPercentDraft(normalizePercent(Number(data.firstDepositBonusPercent) || 0));
      setMessage('First deposit bonus settings saved.');
    } catch (err) {
      setError(getApiErrorMessage(err, 'Could not save first deposit bonus settings.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-white">First Deposit Bonus</h1>
        <p className="mt-1 text-sm text-slate-400">
          Grant a one-time bonus on each user&apos;s first successful approved deposit.
        </p>
      </div>

      <PanelCard
        title="First Deposit Bonus"
        subtitle="Bonus is applied only to the wallet credit after deposit verification succeeds"
      >
        {loading ? (
          <p className="text-sm text-slate-400">Loading settings…</p>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-white">First Deposit Bonus</p>
                <p className="text-xs text-slate-400">
                  When ON, the first approved deposit receives the configured bonus percentage.
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
                Bonus Percentage
              </span>
              <input
                className="mt-2 w-full bg-transparent text-lg font-bold text-white outline-none"
                type="number"
                min={0}
                step={1}
                value={percentDraft}
                onChange={(e) => {
                  const parsed = Number(e.target.value);
                  if (!Number.isFinite(parsed)) return;
                  setPercentDraft(normalizePercent(parsed));
                  setMessage(null);
                }}
              />
              <p className="mt-2 text-xs text-slate-400">
                Examples: 100% → deposit 100 receives 200; 50% → deposit 100 receives 150;
                25% → deposit 100 receives 125; 200% → deposit 100 receives 300.
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
