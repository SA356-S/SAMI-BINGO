import { io, Socket } from 'socket.io-client';
import { getAdminToken } from './auth';
import type {
  GameSnapshot,
  RobotActivityEvent,
  RobotsSnapshotResponse,
  WithdrawRequestsResponse,
  DashboardResponse,
  DailyProfitSummary,
  FinancialSummary,
} from '../types';

const SOCKET_URL =
  import.meta.env.VITE_SOCKET_URL?.replace(/\/$/, '') || '';

type GameListener = (game: GameSnapshot) => void;
type NumberListener = (payload: {
  number: number;
  calledNumbers: number[];
  gameId: string;
}) => void;

let socket: Socket | null = null;
const gameListeners = new Set<GameListener>();
const numberListeners = new Set<NumberListener>();
const robotActivityListeners = new Set<(e: RobotActivityEvent) => void>();
const robotsSnapshotListeners = new Set<
  (s: RobotsSnapshotResponse) => void
>();
const withdrawRequestsListeners = new Set<
  (payload: WithdrawRequestsResponse) => void
>();
const dashboardListeners = new Set<(payload: DashboardResponse) => void>();
const dailyProfitListeners = new Set<(payload: DailyProfitSummary) => void>();
const financialSummaryListeners = new Set<(payload: FinancialSummary) => void>();

function notifyGame(game: GameSnapshot) {
  gameListeners.forEach((fn) => fn(game));
}

function notifyNumber(payload: {
  number: number;
  calledNumbers: number[];
  gameId: string;
}) {
  numberListeners.forEach((fn) => fn(payload));
}

function notifyRobotActivity(payload: RobotActivityEvent) {
  robotActivityListeners.forEach((fn) => fn(payload));
}

function notifyRobotsSnapshot(payload: RobotsSnapshotResponse) {
  robotsSnapshotListeners.forEach((fn) => fn(payload));
}

function notifyWithdrawRequests(payload: WithdrawRequestsResponse) {
  withdrawRequestsListeners.forEach((fn) => fn(payload));
}

function notifyDashboard(payload: DashboardResponse) {
  dashboardListeners.forEach((fn) => fn(payload));
}

function notifyDailyProfit(payload: DailyProfitSummary) {
  dailyProfitListeners.forEach((fn) => fn(payload));
}

function notifyFinancialSummary(payload: FinancialSummary) {
  financialSummaryListeners.forEach((fn) => fn(payload));
}

export function connectAdminSocket() {
  const token = getAdminToken();
  if (!token) return null;

  if (socket?.connected) {
    socket.emit('admin:subscribe', { token });
    return socket;
  }

  socket = io(SOCKET_URL || window.location.origin, {
    path: '/socket.io',
    transports: ['websocket', 'polling'],
    auth: { adminToken: token, token },
  });

  socket.on('connect', () => {
    console.log('[admin] socket connected');
    socket?.emit('admin:subscribe', { token }, (ack: { game?: GameSnapshot }) => {
      if (ack?.game) notifyGame(ack.game);
    });
  });

  const onGameStatus = (payload: GameSnapshot) => {
    if (payload?.gameId) notifyGame(payload);
  };

  const onNewNumber = (payload: {
    number: number;
    calledNumbers?: number[];
    gameId: string;
  }) => {
    if (payload?.number != null) {
      notifyNumber({
        number: payload.number,
        calledNumbers: payload.calledNumbers ?? [],
        gameId: payload.gameId,
      });
    }
  };

  socket.on('gameStatus', onGameStatus);
  socket.on('admin:gameStatus', onGameStatus);
  socket.on('newNumber', onNewNumber);
  socket.on('admin:newNumber', onNewNumber);

  socket.on('admin:robots', (payload: RobotsSnapshotResponse) => {
    if (payload?.ok) notifyRobotsSnapshot(payload);
  });

  socket.on('admin:robotActivity', (payload: RobotActivityEvent) => {
    notifyRobotActivity(payload);
  });

  socket.on('admin:withdrawRequests', (payload: WithdrawRequestsResponse) => {
    if (payload?.ok !== false) notifyWithdrawRequests(payload);
  });

  socket.on('admin:dashboard', (payload: DashboardResponse) => {
    if (payload?.ok) notifyDashboard(payload);
  });

  socket.on('admin:dailyProfit', (payload: DailyProfitSummary) => {
    if (payload?.ok !== false) notifyDailyProfit(payload);
  });

  socket.on('admin:financialSummary', (payload: FinancialSummary) => {
    if (payload?.ok !== false) notifyFinancialSummary(payload);
  });

  return socket;
}

export function disconnectAdminSocket() {
  socket?.disconnect();
  socket = null;
}

export function subscribeGameUpdates(listener: GameListener) {
  gameListeners.add(listener);
  return () => gameListeners.delete(listener);
}

export function subscribeNumberDraws(listener: NumberListener) {
  numberListeners.add(listener);
  return () => numberListeners.delete(listener);
}

export function subscribeRobotActivity(
  listener: (e: RobotActivityEvent) => void
) {
  robotActivityListeners.add(listener);
  return () => robotActivityListeners.delete(listener);
}

export function subscribeRobotsSnapshot(
  listener: (s: RobotsSnapshotResponse) => void
) {
  robotsSnapshotListeners.add(listener);
  return () => robotsSnapshotListeners.delete(listener);
}

export function subscribeWithdrawRequests(
  listener: (payload: WithdrawRequestsResponse) => void
) {
  withdrawRequestsListeners.add(listener);
  return () => withdrawRequestsListeners.delete(listener);
}

export function subscribeDashboardUpdates(
  listener: (payload: DashboardResponse) => void
) {
  dashboardListeners.add(listener);
  return () => dashboardListeners.delete(listener);
}

export function subscribeDailyProfitUpdates(
  listener: (payload: DailyProfitSummary) => void
) {
  dailyProfitListeners.add(listener);
  return () => dailyProfitListeners.delete(listener);
}

export function subscribeFinancialSummaryUpdates(
  listener: (payload: FinancialSummary) => void
) {
  financialSummaryListeners.add(listener);
  return () => financialSummaryListeners.delete(listener);
}
