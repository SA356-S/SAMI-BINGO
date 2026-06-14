const { loadEnv } = require('../config/env');

loadEnv();

const BASE_URL = (
  process.env.VERIFIER_API_URL || 'http://196.189.51.146:3002'
).replace(/\/$/, '');
const API_KEY = process.env.VERIFIER_API_KEY || '';
const TIMEOUT_MS = Number(process.env.VERIFIER_API_TIMEOUT_MS) || 30000;
const MAX_FETCH_RETRIES = Math.max(1, Number(process.env.VERIFIER_API_RETRIES) || 2);

console.info('[verifierApi] configured base URL:', BASE_URL);

function normalizeNetworkError(err) {
  if (err?.name === 'AbortError') return 'verifier_timeout';
  const message = normalizeString(err?.message);
  if (/fetch failed|failed to fetch|network/i.test(message)) return 'verifier_unreachable';
  return message || 'verification_failed';
}

function isRetryableNetworkError(err) {
  const message = normalizeString(err?.message).toLowerCase();
  return (
    err?.name === 'AbortError' ||
    /fetch failed|failed to fetch|econnrefused|enotfound|eai_again|socket hang up|network/i.test(
      message
    )
  );
}

function normalizeString(v) {
  return String(v ?? '').trim();
}

function normalizeApiError(raw) {
  const code = normalizeString(raw).toLowerCase();
  if (!code) return 'verification_failed';
  if (code === 'fetch failed') return 'verifier_unreachable';
  if (/timeout|aborterror/i.test(code)) return 'verifier_timeout';
  if (/econnrefused|enotfound|network|unreachable/i.test(code)) return 'verifier_unreachable';
  return raw;
}

function isVerifierEnabled() {
  const value = process.env.ENABLE_VERIFIER_API;
  if (value === undefined || value === null || value === '') {
    return true;
  }
  const normalized = String(value).trim().toLowerCase();
  return !['false', '0', 'no', 'off'].includes(normalized);
}

async function postJson(path, body, attempt = 1) {
  if (!isVerifierEnabled()) {
    return {
      ok: false,
      status: 0,
      json: { success: false, error: 'verifier_disabled' },
    };
  }

  const url = `${BASE_URL}${path}`;
  console.info('[verifierApi] request:', url);
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (API_KEY) {
    headers['x-api-key'] = API_KEY;
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });

    let json = null;
    const text = await res.text();
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }

    return { ok: res.ok, status: res.status, json };
  } catch (err) {
    const message = normalizeNetworkError(err);
    if (attempt < MAX_FETCH_RETRIES && isRetryableNetworkError(err)) {
      console.warn('[verifierApi] retrying', { path, attempt, message });
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      return postJson(path, body, attempt + 1);
    }
    console.error('[verifierApi] request failed', { path, message, url: BASE_URL });
    return { ok: false, status: 0, json: { success: false, error: message } };
  } finally {
    clearTimeout(timer);
  }
}

async function checkHealth() {
  if (!isVerifierEnabled()) {
    return { ok: false, error: 'verifier_disabled' };
  }

  const url = `${BASE_URL}/health`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, { method: 'GET', signal: ctrl.signal });
    const json = await res.json();
    return { ok: res.ok, json };
  } catch (err) {
    return {
      ok: false,
      error: err?.name === 'AbortError' ? 'verifier_timeout' : err?.message,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Telebirr: POST /verify-telebirr { reference }
 */
async function verifyTelebirr(reference) {
  const ref = String(reference || '').trim();
  if (!ref) {
    return { ok: false, error: 'reference_required' };
  }

  const result = await postJson('/verify-telebirr', { reference: ref });
  if (!result.ok || !result.json?.success) {
    return {
      ok: false,
      error: normalizeApiError(result.json?.error) || 'telebirr_verification_failed',
      status: result.status,
      raw: result.json,
    };
  }

  return { ok: true, data: result.json.data };
}

/**
 * CBE Birr: POST /verify-cbebirr { receiptNumber, phoneNumber }
 */
async function verifyCbeBirr(receiptNumber, phoneNumber) {
  const receipt = String(receiptNumber || '').trim();
  const phone = String(phoneNumber || '').trim();
  if (!receipt || !phone) {
    return { ok: false, error: 'cbebirr_params_required' };
  }

  const result = await postJson('/verify-cbebirr', {
    receiptNumber: receipt,
    phoneNumber: phone,
  });

  const body = result.json;
  if (!result.ok || body?.success === false || body?.error) {
    return {
      ok: false,
      error: normalizeApiError(body?.error) || 'cbebirr_verification_failed',
      status: result.status,
      raw: body,
    };
  }

  return { ok: true, data: body?.data || body };
}

module.exports = {
  isVerifierEnabled,
  checkHealth,
  verifyTelebirr,
  verifyCbeBirr,
  getVerifierBaseUrl: () => BASE_URL,
};
