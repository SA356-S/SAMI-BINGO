import { useMemo, useRef, useState } from 'react';
import PanelCard from '../components/PanelCard';
import { useAdminReady } from '../hooks/useAdminReady';
import {
  broadcastNotification,
  getApiErrorMessage,
  uploadBroadcastImage,
} from '../services/api';

function ActionButton({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={[
        'rounded-xl border px-4 py-2 text-sm font-bold transition',
        disabled
          ? 'cursor-not-allowed border-white/10 bg-white/5 text-slate-400 opacity-60'
          : 'border-indigo-400/30 bg-indigo-500/20 text-indigo-100 hover:bg-indigo-500/30 active:scale-[0.99]',
      ].join(' ')}
    >
      {label}
    </button>
  );
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read image'));
    reader.readAsDataURL(file);
  });
}

export default function BroadcastPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const { authReady, apiReady } = useAdminReady();
  const [message, setMessage] = useState('');
  const [buttonText, setButtonText] = useState('Play');
  const [buttonLink, setButtonLink] = useState('/card-selection');
  const [imagePreview, setImagePreview] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  const actionsReady = authReady && apiReady;
  const busy = uploading || sending;
  const controlsDisabled = busy || !actionsReady;

  const previewSrc = useMemo(() => imagePreview || imageUrl || '', [imagePreview, imageUrl]);

  const onPickImage = async (file: File | null) => {
    if (!file || !actionsReady) return;
    setError('');
    setStatus('');
    setUploading(true);
    try {
      const dataUrl = await fileToDataUrl(file);
      setImagePreview(dataUrl);
      const uploaded = await uploadBroadcastImage(dataUrl, file.type);
      if (!uploaded.ok || !uploaded.imageUrl) {
        setError(uploaded.message || uploaded.error || 'Image upload failed');
        return;
      }
      setImageUrl(uploaded.imageUrl);
      setStatus('Image uploaded');
    } catch (err) {
      setError(getApiErrorMessage(err, 'Image upload failed'));
    } finally {
      setUploading(false);
    }
  };

  const onSend = async () => {
    const text = message.trim();
    if (!text || busy || !actionsReady) return;
    setError('');
    setStatus('');
    setSending(true);
    try {
      const result = await broadcastNotification({
        imageUrl: imageUrl || undefined,
        message: text,
        buttonText: buttonText.trim() || 'Play',
        buttonLink: buttonLink.trim() || '/card-selection',
      });
      if (!result.ok) {
        setError(result.message || result.error || 'Broadcast failed');
        return;
      }
      setStatus(
        result.message ||
          `Telegram bot: ${result.sent ?? 0} sent, ${result.failed ?? 0} failed (${result.recipients ?? 0} users)`
      );
    } catch (err) {
      setError(getApiErrorMessage(err, 'Broadcast failed'));
    } finally {
      setSending(false);
    }
  };

  const onClearImage = () => {
    setImagePreview('');
    setImageUrl('');
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div className="mx-auto max-w-2xl">
      <PanelCard
        title="Broadcast Notification"
        subtitle="Sends a Telegram chat message with a Play button that opens the Mini App in-app"
      >
        <div className="space-y-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Image
            </p>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="mt-2 block w-full text-sm text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-500/20 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-indigo-200"
              disabled={controlsDisabled}
              onChange={(e) => onPickImage(e.target.files?.[0] ?? null)}
            />
            {previewSrc ? (
              <div className="mt-3 overflow-hidden rounded-xl border border-white/10">
                <img
                  src={previewSrc}
                  alt="Preview"
                  className="max-h-56 w-full object-cover"
                />
                <div className="border-t border-white/10 bg-white/5 p-2">
                  <button
                    type="button"
                    onClick={onClearImage}
                    className="text-xs font-semibold text-rose-300 hover:text-rose-200"
                    disabled={controlsDisabled}
                  >
                    Remove image
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          <label className="block rounded-xl border border-white/10 bg-white/5 p-3">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Message
            </span>
            <textarea
              className="mt-2 min-h-[120px] w-full resize-y bg-transparent text-sm text-white outline-none"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Type your announcement…"
              maxLength={2000}
              disabled={controlsDisabled}
            />
          </label>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="rounded-xl border border-white/10 bg-white/5 p-3">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Button text
              </span>
              <input
                className="mt-2 w-full bg-transparent text-sm font-bold text-white outline-none"
                value={buttonText}
                onChange={(e) => setButtonText(e.target.value)}
                disabled={controlsDisabled}
              />
            </label>
            <label className="rounded-xl border border-white/10 bg-white/5 p-3">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Button link
              </span>
              <input
                className="mt-2 w-full bg-transparent text-sm font-bold text-white outline-none"
                value={buttonLink}
                onChange={(e) => setButtonLink(e.target.value)}
                placeholder="/card-selection"
                disabled={controlsDisabled}
              />
            </label>
          </div>

          <p className="text-xs text-slate-400">
            The <strong>Play</strong> button uses Telegram&apos;s{' '}
            <code className="text-indigo-200">web_app</code> control so the game opens inside
            Telegram (not an external browser). Optional path (e.g.{' '}
            <code className="text-indigo-200">/card-selection</code>) is appended to your configured{' '}
            <code className="text-indigo-200">MINI_APP_URL</code>. Messages are sent via Bot API to
            every user with a chatId.
          </p>

          {error ? <p className="text-sm font-semibold text-rose-300">{error}</p> : null}
          {status ? <p className="text-sm font-semibold text-emerald-300">{status}</p> : null}

          <ActionButton
            label={
              sending
                ? 'Sending…'
                : uploading
                  ? 'Uploading image…'
                  : actionsReady
                    ? 'Send broadcast'
                    : 'Preparing…'
            }
            onClick={onSend}
            disabled={controlsDisabled || !message.trim()}
          />
        </div>
      </PanelCard>
    </div>
  );
}
