const DEFAULT_LOCAL_MINI_APP = 'http://localhost:5174';

function normalizeUrl(url) {
  return String(url || '').trim().replace(/\/$/, '');
}

function isLocalDevUrl(url) {
  try {
    const host = new URL(url).hostname;
    return host === 'localhost' || host === '127.0.0.1';
  } catch {
    return false;
  }
}

/** Tunnel / previous-host URLs that must not be used as the Telegram Play button on Railway. */
function isLegacyMiniAppHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  return (
    host.endsWith('.ngrok-free.dev') ||
    host.endsWith('.ngrok.io') ||
    host.endsWith('.ngrok.app') ||
    host.endsWith('.onrender.com')
  );
}

function toHttpsOrigin(raw) {
  const trimmed = normalizeUrl(raw);
  if (!trimmed) return '';
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

/** Railway / Render public host when the monorepo serves the frontend from the same service. */
function resolveDeployedPublicUrl() {
  const railway = normalizeUrl(process.env.RAILWAY_PUBLIC_DOMAIN);
  if (railway) return toHttpsOrigin(railway);

  const railwayStatic = normalizeUrl(process.env.RAILWAY_STATIC_URL);
  if (railwayStatic) return toHttpsOrigin(railwayStatic);

  const render = normalizeUrl(process.env.RENDER_EXTERNAL_URL);
  if (render) return render;

  const cors = String(process.env.CORS_ORIGIN || '')
    .split(',')
    .map((o) => normalizeUrl(o))
    .find((o) => {
      if (!o.startsWith('https://') || isLocalDevUrl(o)) return false;
      try {
        return !isLegacyMiniAppHost(new URL(o).hostname);
      } catch {
        return false;
      }
    });
  if (cors) return cors;

  return '';
}

function getMiniAppUrl() {
  const explicit = normalizeUrl(process.env.MINI_APP_URL);
  const deployed = resolveDeployedPublicUrl();

  if (deployed) {
    if (!explicit || isLocalDevUrl(explicit)) return deployed;
    try {
      if (isLegacyMiniAppHost(new URL(explicit).hostname)) return deployed;
    } catch {
      return deployed;
    }
  }

  return explicit || deployed || DEFAULT_LOCAL_MINI_APP;
}

function validateMiniAppUrl() {
  const url = getMiniAppUrl();
  const backendPort = Number(process.env.PORT) || 3001;
  const explicit = normalizeUrl(process.env.MINI_APP_URL);
  const deployed = resolveDeployedPublicUrl();

  if (explicit && deployed && url === deployed && explicit !== deployed) {
    console.log(
      `[bot] MINI_APP_URL is a legacy host — using deployed origin instead: ${url}`
    );
  } else if (!explicit && deployed) {
    console.log(`[bot] MINI_APP_URL not set — using deployed origin: ${url}`);
  }

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

    if (
      process.env.NODE_ENV === 'production' &&
      (parsed.protocol !== 'https:' || isLocalDevUrl(url))
    ) {
      console.warn(
        `[bot] MINI_APP_URL (${url}) is not a public HTTPS URL. ` +
          'Play and Instruction buttons require a valid HTTPS Mini App URL.'
      );
    }
  } catch {
    console.warn(`[bot] MINI_APP_URL is invalid: ${url}`);
  }

  return url;
}

module.exports = {
  getMiniAppUrl,
  validateMiniAppUrl,
  DEFAULT_LOCAL_MINI_APP,
  resolveDeployedPublicUrl,
  isLegacyMiniAppHost,
};
