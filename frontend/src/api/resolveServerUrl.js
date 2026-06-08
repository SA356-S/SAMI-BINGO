const DEFAULT_SERVER = 'http://localhost:3001';

function isLocalHostname(hostname) {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]'
  );
}

function normalizeBaseUrl(url) {
  return String(url || '').trim().replace(/\/$/, '');
}

function envServerUrl() {
  const fromEnv =
    import.meta.env.VITE_SOCKET_URL ?? import.meta.env.VITE_API_URL;
  const normalized = normalizeBaseUrl(fromEnv);
  if (!normalized) return '';
  try {
    if (isLocalHostname(new URL(normalized).hostname)) return '';
    return normalized;
  } catch {
    return '';
  }
}

/**
 * Public backend base URL for REST + Socket.io.
 * In Telegram/ngrok, uses the Mini App origin (Vite proxies /api + /socket.io).
 */
export function resolveServerUrl() {
  if (typeof window !== 'undefined') {
    const { hostname, origin } = window.location;
    if (!isLocalHostname(hostname)) {
      return origin;
    }
    return DEFAULT_SERVER;
  }

  const fromEnv = envServerUrl();
  if (fromEnv) return fromEnv;

  return DEFAULT_SERVER;
}
