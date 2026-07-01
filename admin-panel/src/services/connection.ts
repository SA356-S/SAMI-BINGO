import axios from 'axios';

/** Grace period before treating the backend as unreachable on initial load. */
export const CONNECTION_GRACE_MS = 4000;

export const CONNECTING_MESSAGE = 'Connecting to server...';

export const PRODUCTION_NETWORK_ERROR_MESSAGE =
  'Unable to connect to the server. Please try again.';

const DEV_NETWORK_ERROR_MESSAGE =
  'Cannot reach backend. Run `npm run backend` on port 3001, then refresh.';

export function isProductionBuild() {
  return import.meta.env.PROD;
}

export function getNetworkErrorMessage() {
  return isProductionBuild()
    ? PRODUCTION_NETWORK_ERROR_MESSAGE
    : DEV_NETWORK_ERROR_MESSAGE;
}

export function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export function isRetryableNetworkError(error: unknown) {
  if (!axios.isAxiosError(error)) return false;
  return !error.response;
}

/**
 * Retry transient network failures during the startup grace window so a slow
 * backend/socket handshake does not flash a false offline error.
 */
export async function fetchWithStartupRetry<T>(
  fn: () => Promise<T>,
  options: { graceMs?: number; intervalMs?: number } = {}
): Promise<T> {
  const graceMs = options.graceMs ?? CONNECTION_GRACE_MS;
  const intervalMs = options.intervalMs ?? 750;
  const deadline = Date.now() + graceMs;

  while (true) {
    try {
      return await fn();
    } catch (error) {
      if (!isRetryableNetworkError(error)) {
        throw error;
      }
      if (Date.now() >= deadline) {
        throw error;
      }
      await sleep(Math.min(intervalMs, Math.max(0, deadline - Date.now())));
    }
  }
}

/** Warn if a production build is configured to call localhost. */
export function warnProductionMisconfig() {
  if (!isProductionBuild()) return;

  const apiUrl = import.meta.env.VITE_API_URL?.trim();
  const socketUrl = import.meta.env.VITE_SOCKET_URL?.trim();

  if (apiUrl && /localhost|127\.0\.0\.1/i.test(apiUrl)) {
    console.warn(
      '[admin] VITE_API_URL points to localhost in a production build:',
      apiUrl
    );
  }
  if (socketUrl && /localhost|127\.0\.0\.1/i.test(socketUrl)) {
    console.warn(
      '[admin] VITE_SOCKET_URL points to localhost in a production build:',
      socketUrl
    );
  }
}
