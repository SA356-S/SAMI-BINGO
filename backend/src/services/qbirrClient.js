/**
 * qbirr payment verification client.
 * Only the backend may call this. Never expose QBIRR_API_KEY to clients.
 */

const DEFAULT_BASE_URL = 'https://verify.qbirr.com';
const DEFAULT_TIMEOUT_MS = 30000;

function getBaseUrl() {
  return String(process.env.QBIRR_BASE_URL || DEFAULT_BASE_URL).trim().replace(/\/$/, '');
}

function getApiKey() {
  return String(process.env.QBIRR_API_KEY || '').trim();
}

function getTimeoutMs() {
  const configured = Number(process.env.QBIRR_TIMEOUT_MS);
  if (Number.isFinite(configured) && configured > 0) return configured;
  return DEFAULT_TIMEOUT_MS;
}

function getVerifyUrl() {
  const base = getBaseUrl();
  if (/\/api\/v1\/verify\/?$/i.test(base)) return base.replace(/\/$/, '');
  return `${base}/api/v1/verify`;
}

function parseQbirrAmount(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const cleaned = String(value ?? '').replace(/,/g, '').replace(/[^\d.]/g, '');
  const amount = Number(cleaned);
  return Number.isFinite(amount) ? amount : null;
}

function unwrapQbirrPayload(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  if (raw.data && typeof raw.data === 'object') return { ...raw, ...raw.data };
  if (raw.result && typeof raw.result === 'object') return { ...raw, ...raw.result };
  return raw;
}

function sanitizeQbirrResponse(raw) {
  const payload = unwrapQbirrPayload(raw);
  if (!payload || typeof payload !== 'object') {
    return { verified: false, payer: '', amount: null, error: '' };
  }
  const verified =
    payload.verified === true ||
    payload.verified === 'true' ||
    payload.success === true ||
    payload.status === 'verified';
  return {
    verified,
    payer: payload.payer == null ? '' : String(payload.payer),
    amount: parseQbirrAmount(payload.amount),
    error: payload.error == null ? '' : String(payload.error).slice(0, 500),
  };
}

/**
 * POST /api/v1/verify
 * @param {{ provider: string, ref: string, amount: number, receiver_name: string, receiver_account?: string }} payload
 */
async function verifyWithQbirr(payload, fetchImpl = fetch) {
  const apiKey = getApiKey();
  if (!apiKey) {
    return { ok: false, error: 'deposit_not_configured' };
  }

  const url = getVerifyUrl();
  const body = {
    provider: payload.provider,
    ref: payload.ref,
    amount: payload.amount,
    receiver_name: payload.receiver_name,
  };
  if (payload.provider === 'cbe' && payload.receiver_account) {
    body.receiver_account = payload.receiver_account;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), getTimeoutMs());

  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    let json = null;
    try {
      json = await response.json();
    } catch {
      json = null;
    }

    const qbirr = sanitizeQbirrResponse(json);
    console.info('[qbirr] verify', {
      url,
      provider: payload.provider,
      refLength: String(payload.ref || '').length,
      httpStatus: response.status,
      verified: qbirr.verified,
      error: qbirr.error || '',
    });

    if (!response.ok) {
      if (response.status >= 500) {
        return { ok: false, error: 'qbirr_unavailable', qbirr };
      }
      if (qbirr.verified !== true) {
        return {
          ok: false,
          error: 'verification_failed',
          qbirr,
          httpStatus: response.status,
        };
      }
    }

    if (qbirr.verified !== true) {
      return { ok: false, error: 'verification_failed', qbirr };
    }

    return { ok: true, qbirr };
  } catch (err) {
    if (err?.name === 'AbortError') {
      return { ok: false, error: 'qbirr_timeout' };
    }
    console.warn('[qbirr] request failed', { name: err?.name, message: err?.message });
    return { ok: false, error: 'qbirr_unavailable' };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  DEFAULT_BASE_URL,
  getBaseUrl,
  getVerifyUrl,
  getApiKey,
  sanitizeQbirrResponse,
  verifyWithQbirr,
};
