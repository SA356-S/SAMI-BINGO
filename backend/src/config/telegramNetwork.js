const https = require('https');
const dns = require('dns');

// Prefer IPv4 on Windows — avoids intermittent IPv6 connect timeouts to api.telegram.org.
dns.setDefaultResultOrder('ipv4first');

const TELEGRAM_API_HOST = 'api.telegram.org';
const REQUEST_TIMEOUT_MS = Number(process.env.TELEGRAM_REQUEST_TIMEOUT_MS) || 25_000;
const MAX_WARMUP_ATTEMPTS = Number(process.env.TELEGRAM_WARMUP_RETRIES) || 12;
const MAX_RETRY_ATTEMPTS = Number(process.env.TELEGRAM_API_RETRIES) || 8;
const BASE_BACKOFF_MS = Number(process.env.TELEGRAM_BACKOFF_MS) || 1500;
const MAX_BACKOFF_MS = Number(process.env.TELEGRAM_MAX_BACKOFF_MS) || 30_000;

const RETRYABLE =
  /ETIMEDOUT|ECONNRESET|ENOTFOUND|EAI_AGAIN|socket hang up|FetchError|request timeout|aborted/i;

const PROXY_ENV_KEYS = [
  'HTTPS_PROXY',
  'https_proxy',
  'HTTP_PROXY',
  'http_proxy',
  'ALL_PROXY',
  'all_proxy',
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function exponentialBackoff(attempt) {
  const delay = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** (attempt - 1));
  return delay + Math.floor(Math.random() * 400);
}

function isRetryableError(err) {
  const message = err?.message ?? String(err);
  return RETRYABLE.test(message);
}

/**
 * Warn if proxy env vars are set — a misconfigured proxy often causes ETIMEDOUT to Telegram.
 * Telegram requests use direct Node HTTPS (default agent), not a custom proxy agent.
 */
function warnIfProxyConfigured() {
  for (const key of PROXY_ENV_KEYS) {
    const value = String(process.env[key] || '').trim();
    if (!value) continue;
    console.warn(
      `[bot] ${key}=${value} — Telegram connects directly to https://${TELEGRAM_API_HOST}:443. ` +
        'A broken proxy can cause ETIMEDOUT; unset proxy vars or add api.telegram.org to NO_PROXY.'
    );
  }
}

/**
 * Telegraf default TLS stack — no custom agent (avoids family/keepAlive quirks on some networks).
 */
function getTelegrafOptions() {
  return {};
}

function nativeGetMe(token) {
  const url = `https://${TELEGRAM_API_HOST}/bot${token}/getMe`;

  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (!json.ok) {
            reject(new Error(json.description || 'Telegram getMe failed'));
            return;
          }
          resolve(json.result);
        } catch (err) {
          reject(err);
        }
      });
    });

    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error(`Telegram request timeout after ${REQUEST_TIMEOUT_MS}ms`));
    });

    req.on('error', reject);
  });
}

async function withExponentialRetry(label, fn, { maxAttempts = MAX_RETRY_ATTEMPTS } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const message = err?.message ?? String(err);
      if (!isRetryableError(err) || attempt === maxAttempts) {
        throw err;
      }
      const delay = exponentialBackoff(attempt);
      console.warn(
        `[bot] ${label} attempt ${attempt}/${maxAttempts} failed (${message}); retrying in ${delay}ms`
      );
      await sleep(delay);
    }
  }
  throw lastErr;
}

/**
 * Warm up route to api.telegram.org before Telegraf launch (getMe with retries).
 */
async function warmupTelegramConnection(token, { maxAttempts = MAX_WARMUP_ATTEMPTS } = {}) {
  warnIfProxyConfigured();

  return withExponentialRetry(
    'Telegram warmup',
    async () => {
      const botInfo = await nativeGetMe(token);
      return botInfo;
    },
    { maxAttempts }
  ).then((botInfo) => {
    console.log(`[bot] Telegram API reachable (@${botInfo.username})`);
    return botInfo;
  });
}

/**
 * Retry Telegraf launch / API calls on transient network failures.
 */
async function withTelegramRetry(label, fn, options = {}) {
  return withExponentialRetry(label, fn, options);
}

module.exports = {
  getTelegrafOptions,
  warmupTelegramConnection,
  withTelegramRetry,
  warnIfProxyConfigured,
};
