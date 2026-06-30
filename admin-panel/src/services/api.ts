import axios from 'axios';
import { getAdminToken, getAdminTelegramId } from './auth';
import type {
  DashboardResponse,
  GameSnapshot,
  PaymentRow,
  PlayerRow,
  CartelaRow,
  UserSearchResponse,
  AddBalanceResponse,
  RobotsSnapshotResponse,
  RobotProfileRow,
  RobotAdvantageSettings,
  CardSelectionTimeSettings,
  RegistrationBonusSettings,
  WithdrawRequestsResponse,
  WithdrawRequestStatus,
  DailyProfitSummary,
  FinancialSummary,
} from '../types';

// Dev default uses Vite proxy (/api -> backend :3001). Override with VITE_API_URL for production.
const API_BASE =
  import.meta.env.VITE_API_URL?.replace(/\/$/, '') || '/api';

export const api = axios.create({
  baseURL: API_BASE,
  headers: { Accept: 'application/json' },
  timeout: 20000,
});

api.interceptors.request.use((config) => {
  const token = getAdminToken();
  const telegramId = getAdminTelegramId();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
    config.headers['X-Admin-Token'] = token;
  }
  if (telegramId) {
    config.headers['X-Admin-Telegram-Id'] = telegramId;
  }
  return config;
});

export function getApiErrorMessage(error: unknown, fallback: string) {
  if (axios.isAxiosError(error)) {
    if (!error.response) {
      return 'Cannot reach backend. Run `npm run backend` on port 3001, then refresh.';
    }
    const data = error.response.data as { message?: string; error?: string } | undefined;
    if (data?.message) return data.message;
    if (data?.error === 'admin_unauthorized') {
      return 'Admin session expired. Log out and sign in again.';
    }
    if (data?.error) return String(data.error);
    return fallback;
  }
  if (error instanceof Error) return error.message;
  return fallback;
}

/** Verify backend + database are reachable (no admin token required). */
export async function fetchBackendHealth() {
  const base = API_BASE.replace(/\/api\/?$/, '') || '';
  const url = `${base}/health`;
  const { data } = await axios.get<{
    ok: boolean;
    service: string;
    activeSessions?: number;
  }>(url, { timeout: 8000 });
  return data;
}

export async function login(password: string, telegramId: string) {
  const { data } = await api.post<{
    ok: boolean;
    token: string;
    role: 'admin' | 'manager';
    telegramId: number;
  }>('/admin/login', { password, telegramId });
  return data;
}

export type ManagedUser = {
  id: string;
  userId: string;
  telegramId: number;
  username: string;
  role: string;
  roleLabel: string;
  isBanned: boolean;
  banReason: string;
  bannedAt: string | null;
  status: 'active' | 'banned';
};

export async function fetchManagedUsers(params?: {
  limit?: number;
  search?: string;
}) {
  const { data } = await api.get<{
    ok: boolean;
    total: number;
    users: ManagedUser[];
  }>('/users/management', { params });
  return data;
}

export async function makeUserAdmin(userId: string) {
  const { data } = await api.put(`/users/${userId}/make-admin`);
  return data;
}

export async function removeUserAdmin(userId: string) {
  const { data } = await api.put(`/users/${userId}/remove-admin`);
  return data;
}

export async function makeUserManager(userId: string) {
  const { data } = await api.put(`/users/${userId}/make-manager`);
  return data;
}

export async function removeUserManager(userId: string, role: 'admin' | 'user' = 'admin') {
  const { data } = await api.put(`/users/${userId}/remove-manager`, { role });
  return data;
}

export async function banUser(userId: string, banReason?: string) {
  const { data } = await api.put(`/users/${userId}/ban`, { banReason });
  return data;
}

export async function unbanUser(userId: string) {
  const { data } = await api.put(`/users/${userId}/unban`);
  return data;
}

export async function fetchDashboard() {
  const { data } = await api.get<DashboardResponse>('/admin/dashboard');
  return data;
}

export async function fetchDailyProfit() {
  const { data } = await api.get<DailyProfitSummary>('/admin/daily-profit');
  return data;
}

export async function fetchFinancialSummary() {
  const { data } = await api.get<FinancialSummary>('/admin/financial-summary');
  return data;
}

export async function fetchRobotsSnapshot() {
  const { data } = await api.get<RobotsSnapshotResponse>('/admin/robots');
  return data;
}

export async function createRobot(name: string) {
  const trimmed = String(name ?? '').trim();
  const { data } = await api.post<{
    ok: boolean;
    robot?: RobotProfileRow;
    error?: string;
    message?: string;
  }>('/robots/create', { name: trimmed });
  return data;
}

export async function setRobotEnabled(robotId: string, enabled: boolean) {
  const { data } = await api.patch(`/admin/robots/${encodeURIComponent(robotId)}`, {
    status: enabled ? 'on' : 'off',
    enabled,
  });
  return data;
}

export async function updateRobotConfig(patch: Partial<RobotsSnapshotResponse['config']>) {
  const { data } = await api.put('/admin/robots/config', patch);
  return data as RobotsSnapshotResponse;
}

export async function topupRobotBank(amount: number) {
  const { data } = await api.post('/admin/robots/bank/topup', { amount });
  return data;
}

export async function fetchRobotAdvantageSettings() {
  const { data } = await api.get<RobotAdvantageSettings>('/settings/robot-advantage');
  return data;
}

export async function uploadBroadcastImage(imageBase64: string, mimeType?: string) {
  const { data } = await api.post<{
    ok: boolean;
    imageUrl?: string;
    error?: string;
    message?: string;
  }>('/notifications/upload-image', { imageBase64, mimeType });
  return data;
}

export async function broadcastNotification(payload: {
  imageUrl?: string;
  message: string;
  buttonText?: string;
  buttonLink?: string;
}) {
  const { data } = await api.post<{
    ok: boolean;
    channel?: string;
    recipients?: number;
    sent?: number;
    failed?: number;
    failedChatIds?: { chatId: number; error?: string; message?: string }[];
    error?: string;
    message?: string;
  }>('/notifications/broadcast', payload);
  return data;
}

export async function updateRobotAdvantageSettings(robotAdvantageLevel: number) {
  const { data } = await api.put<RobotAdvantageSettings>('/settings/robot-advantage', {
    robotAdvantageLevel,
  });
  return data;
}

export async function fetchCardSelectionTimeSettings() {
  const { data } = await api.get<CardSelectionTimeSettings>(
    '/settings/card-selection-time'
  );
  return data;
}

export async function updateCardSelectionTimeSettings(seconds: number) {
  const { data } = await api.put<CardSelectionTimeSettings>(
    '/settings/card-selection-time',
    { cardSelectionTime: seconds }
  );
  return data;
}

export async function fetchRegistrationBonusSettings() {
  const { data } = await api.get<RegistrationBonusSettings>(
    '/settings/registration-bonus'
  );
  return data;
}

export async function updateRegistrationBonusSettings(payload: {
  registrationBonusEnabled?: boolean;
  registrationBonusAmount?: number;
}) {
  const { data } = await api.put<RegistrationBonusSettings>(
    '/settings/registration-bonus',
    payload
  );
  return data;
}

export async function fetchGameState(gameId?: string) {
  const { data } = await api.get<{ ok: boolean; game: GameSnapshot }>(
    '/admin/game/state',
    { params: gameId ? { gameId } : {} }
  );
  return data.game;
}

export async function startGame(gameId?: string) {
  const { data } = await api.post<{ ok: boolean; game: GameSnapshot }>(
    '/admin/game/start',
    { gameId, forceStart: true }
  );
  return data;
}

export async function stopGame(gameId?: string) {
  const { data } = await api.post<{ ok: boolean; game: GameSnapshot }>(
    '/admin/game/stop',
    { gameId }
  );
  return data;
}

export async function drawNumber(gameId?: string) {
  const { data } = await api.post<{
    ok: boolean;
    number?: number;
    game: GameSnapshot;
  }>('/admin/game/draw', { gameId });
  return data;
}

export async function resetGame(gameId?: string) {
  const { data } = await api.post<{ ok: boolean; game: GameSnapshot }>(
    '/admin/game/reset',
    { gameId }
  );
  return data;
}

export async function fetchPlayers(gameId?: string) {
  const { data } = await api.get<{
    ok: boolean;
    total: number;
    active: number;
    players: PlayerRow[];
  }>('/admin/players', { params: gameId ? { gameId } : {} });
  return data;
}

export async function fetchCartelas(gameId?: string) {
  const { data } = await api.get<{
    ok: boolean;
    soldCount: number;
    cartelas: CartelaRow[];
    takenCartels: number[];
  }>('/admin/cartelas', { params: gameId ? { gameId } : {} });
  return data;
}

export async function fetchPayments() {
  const { data } = await api.get<{
    ok: boolean;
    deposits: PaymentRow[];
    withdraws: PaymentRow[];
  }>('/admin/payments');
  return data;
}

export async function fetchWithdrawRequests(status?: WithdrawRequestStatus) {
  const { data } = await api.get<WithdrawRequestsResponse>(
    '/admin/withdraw-requests',
    { params: status ? { status } : {} }
  );
  return data;
}

export async function approveWithdrawRequest(requestId: string) {
  const { data } = await api.post<{ ok: boolean; request?: unknown; error?: string }>(
    `/admin/withdraw-requests/${encodeURIComponent(requestId)}/approve`
  );
  return data;
}

export async function rejectWithdrawRequest(requestId: string) {
  const { data } = await api.post<{ ok: boolean; request?: unknown; error?: string }>(
    `/admin/withdraw-requests/${encodeURIComponent(requestId)}/reject`
  );
  return data;
}

export async function searchUser(query: string) {
  const { data } = await api.get<UserSearchResponse>('/users/search', {
    params: { query: query.trim() },
  });
  return data;
}

export async function fetchRecentUsers(limit = 25) {
  const { data } = await api.get<UserSearchResponse & { total?: number }>(
    '/users/recent',
    { params: { limit } }
  );
  return data;
}

export async function addUserBalance(userId: string, amount: number) {
  const { data } = await api.post<AddBalanceResponse>('/users/add-balance', {
    userId,
    amount,
  });
  return data;
}
