const DEFAULT_LOCAL_MINI_APP = 'http://localhost:5174';

function normalizeUrl(url) {
  return String(url || '').trim().replace(/\/$/, '');
}

function getMiniAppUrl() {
  return normalizeUrl(process.env.MINI_APP_URL) || DEFAULT_LOCAL_MINI_APP;
}

function validateMiniAppUrl() {
  const url = getMiniAppUrl();
  const backendPort = Number(process.env.PORT) || 3001;

  try {
    const parsed = new URL(url);
    const port = parsed.port
      ? Number(parsed.port)
      : parsed.protocol === 'https:'
        ? 443
        : 80;

    if (port === backendPort) {
      console.warn(
        `[bot] MINI_APP_URL (${url}) points at the backend port (${backendPort}). ` +
          'Telegram must open the Vite frontend on port 5174. Example: ngrok http 5174'
      );
    }
  } catch {
    console.warn(`[bot] MINI_APP_URL is invalid: ${url}`);
  }

  return url;
}

module.exports = { getMiniAppUrl, validateMiniAppUrl, DEFAULT_LOCAL_MINI_APP };
