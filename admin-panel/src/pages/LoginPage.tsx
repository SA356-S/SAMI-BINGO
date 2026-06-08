import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getApiErrorMessage } from '../services/api';
import { getAdminRole } from '../services/auth';

export default function LoginPage() {
  const navigate = useNavigate();
  const { login, authed } = useAuth();

  const [password, setPassword] = useState('admin123');
  const [telegramId, setTelegramId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setLocalError(null);
    try {
      await login(password, telegramId);
      const r = getAdminRole();
      navigate(r === 'admin' ? '/withdraw-requests' : '/dashboard', {
        replace: true,
      });
    } catch (err: unknown) {
      setLocalError(getApiErrorMessage(err, 'Login failed'));
    } finally {
      setSubmitting(false);
    }
  }

  if (authed) {
    const r = getAdminRole();
    navigate(r === 'admin' ? '/withdraw-requests' : '/dashboard', { replace: true });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0a0a14] p-6">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-6 shadow-sm">
        <h1 className="text-xl font-bold tracking-wide text-white">Admin Login</h1>
        <p className="mt-2 text-sm text-slate-400">
          Sign in with the admin password and your Telegram user ID. Only accounts
          with Admin or Manager role can access this panel.
        </p>

        <form onSubmit={onSubmit} className="mt-5 space-y-4">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-300">
              Telegram ID
            </span>
            <input
              value={telegramId}
              onChange={(e) => setTelegramId(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-[#0f172a] px-3 py-2 text-white outline-none focus:border-indigo-400/60"
              inputMode="numeric"
              required
              placeholder="Your numeric Telegram id"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-300">
              Password
            </span>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-[#0f172a] px-3 py-2 text-white outline-none focus:border-indigo-400/60"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>

          {localError ? (
            <div className="rounded-lg border border-danger bg-danger/10 px-3 py-2 text-sm text-danger">
              {localError}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-xl bg-indigo-500/90 px-4 py-2 text-sm font-bold text-white shadow hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="mt-4 text-xs text-slate-500">
          First manager: set <code className="text-slate-300">BOOTSTRAP_MANAGER_TELEGRAM_ID</code>{' '}
          in backend env, open the Mini App once, then log in here.
        </p>
      </div>
    </div>
  );
}
