import axios, { type InternalAxiosRequestConfig } from 'axios';
import {
  getAdminRole,
  getAdminTelegramId,
  getAdminToken,
  isAuthenticated,
  type AdminRole,
} from './auth';

const LOCALHOST_PATTERN = /localhost|127\.0\.0\.1/i;
const VALIDATION_HEADER = 'X-Admin-Client-Validate';

/**
 * Production always uses same-origin `/api`.
 * Localhost env vars are ignored completely at runtime in production builds.
 */
export function resolveApiBaseUrl(): string {
  if (import.meta.env.PROD) {
    return '/api';
  }

  const configured = import.meta.env.VITE_API_URL?.trim().replace(/\/$/, '');
  if (configured && LOCALHOST_PATTERN.test(configured)) {
    return '/api';
  }
  return configured || '/api';
}

type HydratedSession = {
  token: string;
  telegramId: string;
  role: AdminRole;
};

type ClientContext = {
  session: HydratedSession;
};

export type AdminReadyState = {
  authReady: boolean;
  apiReady: boolean;
  interceptorsReady: boolean;
};

function readSessionSnapshot(): HydratedSession | null {
  if (!isAuthenticated()) return null;

  const token = getAdminToken()?.trim() || '';
  const telegramId = getAdminTelegramId()?.trim() || '';
  const role = getAdminRole();

  if (!token || !telegramId || !role) return null;

  return { token, telegramId, role };
}

function attachSessionHeaders(
  config: InternalAxiosRequestConfig,
  session: HydratedSession
) {
  config.headers.Authorization = `Bearer ${session.token}`;
  config.headers['X-Admin-Token'] = session.token;
  config.headers['X-Admin-Telegram-Id'] = session.telegramId;
}

function isPublicApiPath(url?: string): boolean {
  const path = String(url || '').split('?')[0];
  return path === '/admin/login';
}

function isValidationRequest(config: InternalAxiosRequestConfig): boolean {
  return String(config.headers?.[VALIDATION_HEADER] ?? '') === '1';
}

function requiresAuthenticatedApi(url?: string): boolean {
  const path = String(url || '').split('?')[0];
  if (!path || isPublicApiPath(path)) return false;
  return true;
}

export function logAdminApiFailure(
  phase: string,
  error: unknown,
  extra: Record<string, unknown> = {}
) {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const kind = status ? `http_${status}` : 'network';
    console.error('[admin-api] request failed', {
      phase,
      kind,
      status: status ?? null,
      code: error.code ?? null,
      url: error.config?.url ?? null,
      ...extra,
    });
    return;
  }

  console.error('[admin-api] request failed', { phase, error, ...extra });
}

function createAdminClient() {
  const API_BASE = resolveApiBaseUrl();

  const api = axios.create({
    baseURL: API_BASE,
    headers: { Accept: 'application/json' },
    timeout: 20000,
  });

  let state: AdminReadyState = {
    authReady: false,
    apiReady: false,
    interceptorsReady: false,
  };

  const listeners = new Set<() => void>();

  /** Confirmed after request interceptor is registered (same synchronous turn). */
  let infrastructureReady: Promise<void> = Promise.resolve();

  /** Resolves after localStorage/session snapshot is read on a microtask. */
  let hydrationPromise: Promise<HydratedSession | null> = Promise.resolve(null);

  /** Single shared lock: hydration + API validation. All authed requests await this. */
  let clientReadyLock: Promise<ClientContext> | null = null;

  function notifyReadyListeners() {
    listeners.forEach((listener) => listener());
  }

  function patchReadyState(next: Partial<AdminReadyState>) {
    state = { ...state, ...next };
    notifyReadyListeners();
  }

  function scheduleSessionHydration(): Promise<HydratedSession | null> {
    hydrationPromise = Promise.resolve().then(() => readSessionSnapshot());
    return hydrationPromise;
  }

  async function resolveHydratedSession(): Promise<HydratedSession> {
    await infrastructureReady;
    const session = (await hydrationPromise) ?? readSessionSnapshot();
    if (!session) {
      throw new Error('Admin session incomplete (missing token, telegram id, or role)');
    }
    return session;
  }

  async function runClientInitialization(): Promise<ClientContext> {
    patchReadyState({ authReady: false, apiReady: false });

    const session = await resolveHydratedSession();
    patchReadyState({ authReady: true });
    console.info('[admin-api] authReady', {
      apiBase: API_BASE,
      interceptorsReady: state.interceptorsReady,
    });

    try {
      await api.get('/admin/dashboard', {
        timeout: 15000,
        headers: { [VALIDATION_HEADER]: '1' },
      });
    } catch (error) {
      logAdminApiFailure('api_validation', error, { apiBase: API_BASE });
      patchReadyState({ apiReady: false });
      clientReadyLock = null;
      throw error;
    }

    patchReadyState({ apiReady: true });
    console.info('[admin-api] apiReady', { apiBase: API_BASE });

    return { session };
  }

  function getClientReadyLock(): Promise<ClientContext> {
    if (!clientReadyLock) {
      clientReadyLock = runClientInitialization();
    }
    return clientReadyLock;
  }

  api.interceptors.request.use(async (config) => {
    await infrastructureReady;

    if (!requiresAuthenticatedApi(config.url)) {
      return config;
    }

    if (isValidationRequest(config)) {
      try {
        const session = await resolveHydratedSession();
        attachSessionHeaders(config, session);
      } catch (error) {
        logAdminApiFailure('validation_hydration', error, { apiBase: API_BASE });
        throw error;
      }
      return config;
    }

    const { session } = await getClientReadyLock();
    attachSessionHeaders(config, session);
    return config;
  });

  patchReadyState({ interceptorsReady: true });
  scheduleSessionHydration();

  function getAdminReadyState(): AdminReadyState {
    return { ...state };
  }

  function subscribeAdminReady(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function resetAdminClient() {
    clientReadyLock = null;
    scheduleSessionHydration();
    patchReadyState({ authReady: false, apiReady: false });
  }

  async function initializeAdminClient(): Promise<void> {
    if (!readSessionSnapshot()) {
      const error = new Error(
        'Admin session incomplete (missing token, telegram id, or role)'
      );
      logAdminApiFailure('auth_init', error, { apiBase: API_BASE });
      throw error;
    }
    await getClientReadyLock();
  }

  async function assertAdminClientReady(): Promise<void> {
    await getClientReadyLock();
  }

  return {
    api,
    API_BASE,
    getAdminReadyState,
    subscribeAdminReady,
    resetAdminClient,
    initializeAdminClient,
    assertAdminClientReady,
    getClientReadyLock,
  };
}

const adminClient = createAdminClient();

export const api = adminClient.api;
export const API_BASE = adminClient.API_BASE;

export const getAdminReadyState = adminClient.getAdminReadyState;
export const subscribeAdminReady = adminClient.subscribeAdminReady;
export const resetAdminClient = adminClient.resetAdminClient;
export const initializeAdminClient = adminClient.initializeAdminClient;
export const assertAdminClientReady = adminClient.assertAdminClientReady;
export const getClientReadyLock = adminClient.getClientReadyLock;
