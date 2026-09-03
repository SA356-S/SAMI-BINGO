export type GameStatusLabel = 'RUNNING' | 'STOPPED' | 'FINISHED';

export interface PlayerRow {
  socketId: string;
  userId?: string;
  playerName: string;
  displayName: string;
  cartelCount: number;
  seatNumber: number;
  cartelIds: number[];
  status: string;
}

export interface CartelaRow {
  cartelId: number;
  userId?: string;
  playerName: string;
  status: string;
}

export interface GameSnapshot {
  gameId: string;
  status: GameStatusLabel;
  rawStatus: string;
  lobbyPhase?: string;
  calledNumbers: number[];
  latestBall: number | null;
  playersCount: number;
  activePlayersCount: number;
  derash: number;
  pot: number;
  totalPool: number;
  countdownSeconds?: number;
  players: PlayerRow[];
  cartelas: CartelaRow[];
  soldCartelasCount: number;
}

export interface PaymentRow {
  id: string;
  userId: string;
  amount: number;
  reference: string;
  channel: string;
  detail: string;
  status: string;
  createdAt: string;
}

export type WithdrawRequestStatus = 'pending' | 'approved' | 'rejected';

export interface WithdrawRequestRow {
  id: string;
  userId: string;
  telegramUsername: string;
  telegramFirstName: string;
  amount: number;
  paymentMethod: string;
  paymentMethodLabel: string;
  phone: string;
  accountName: string;
  status: WithdrawRequestStatus;
  mainWalletAtRequest: number;
  createdAt: string;
  updatedAt?: string;
}

export interface WithdrawRequestStats {
  pending: number;
  approved: number;
  rejected: number;
  total: number;
}

export interface WithdrawRequestsResponse {
  ok: boolean;
  requests: WithdrawRequestRow[];
  stats: WithdrawRequestStats;
}

export type ManualDepositStatus = 'pending' | 'approved' | 'rejected';

export interface ManualDepositRow {
  id: string;
  userId: string;
  telegramUsername: string;
  telegramFirstName: string;
  telegramLastName: string;
  displayName: string;
  submittedAmount: number | null;
  approvedAmount: number | null;
  amount: number | null;
  photoFileId: string;
  photoCaption: string;
  status: ManualDepositStatus;
  walletCredited: boolean;
  screenshotUrl: string;
  createdAt: string;
  updatedAt?: string;
  reviewedAt: string | null;
  reviewedByTelegramId: string;
  reviewedByRole: string;
}

export interface ManualDepositStats {
  pending: number;
  approved: number;
  rejected: number;
  total: number;
}

export interface ManualDepositsResponse {
  ok: boolean;
  requests: ManualDepositRow[];
  stats: ManualDepositStats;
}

export interface FinancialPeriodStats {
  depositTotal: number;
  depositCount: number;
  withdrawalTotal: number;
  withdrawalCount: number;
  netRevenue: number;
}

export type FinancialPeriodKey =
  | 'last24h'
  | 'today'
  | 'last7days'
  | 'thisMonth'
  | 'lifetime';

export interface FinancialSummary {
  ok: boolean;
  generatedAt: string;
  currency: string;
  periods: Record<FinancialPeriodKey, FinancialPeriodStats>;
}

export interface DailyProfitDayRow {
  date: string;
  totalGamesPlayed: number;
  gamesCount: number;
  totalBets: number;
  totalRevenue: number;
  totalPayouts: number;
  houseProfit: number;
  netProfit: number;
}

export interface DailyProfitSummary {
  ok: boolean;
  today: DailyProfitDayRow;
  yesterday: DailyProfitDayRow;
  weekly: DailyProfitDayRow & {
    from: string;
    to: string;
    days: DailyProfitDayRow[];
  };
}

export interface DashboardResponse {
  ok: boolean;
  sessions: { gameId: string; playersCount: number; status: string; calledCount: number }[];
  game: GameSnapshot;
  withdrawRequests?: WithdrawRequestStats;
  dailyProfit?: DailyProfitSummary;
}

export interface AdminUserRow {
  userId: string;
  telegramId: number;
  username: string;
  name: string;
  phone: string;
  registrationStatus: string;
  mainWallet: number;
  playWallet: number;
  totalWalletBalance: number;
}

export interface UserSearchResponse {
  ok: boolean;
  user?: AdminUserRow;
  users?: AdminUserRow[];
  error?: string;
  message?: string;
}

export interface AddBalanceResponse {
  ok: boolean;
  userId?: string;
  amount?: number;
  user?: AdminUserRow;
  mainWallet?: number;
  playWallet?: number;
  totalWalletBalance?: number;
  error?: string;
  message?: string;
}

export interface RobotStatsRow {
  gamesPlayed: number;
  wins: number;
  losses: number;
  totalStake: number;
  totalPrizes: number;
  netPnl: number;
  activeGames: number;
}

export type RobotStatus = 'on' | 'off';

export interface RobotProfileRow {
  robotId: string;
  name?: string;
  displayName: string;
  username: string;
  avatarSeed: string;
  status?: RobotStatus;
  enabled: boolean;
  active: boolean;
  createdAt?: string;
  stats: RobotStatsRow;
}

export interface RobotConfigSnapshot {
  enabledGlobal: boolean;
  minCards: number;
  maxCards: number;
  maxActiveRobots: number;
  activityLevel: number;
  joinJitterMs: number;
  leaveJitterMs: number;
  bankBalance: number;
}

export type RobotAdvantageEffectLabel = 'FAIR' | 'LOW' | 'MEDIUM' | 'HIGH';

export interface RobotAdvantageSettings {
  ok?: boolean;
  robotAdvantageLevel: number;
  targetWinBallCount: number | null;
  targetWinBallCountMin: number | null;
  targetWinBallCountMax: number | null;
  effectLabel: RobotAdvantageEffectLabel;
  /** @deprecated Legacy timing preview — robots now use ball-count targets. */
  speedMultiplier?: number;
  markingDelayMs?: number;
  patternCheckIntervalMs?: number;
  claimDelayMs?: number;
}

export interface CardSelectionTimeSettings {
  ok?: boolean;
  cardSelectionTime: number;
  minSeconds: number;
  maxSeconds: number;
}

export interface RegistrationBonusSettings {
  ok?: boolean;
  registrationBonusEnabled: boolean;
  registrationBonusAmount: number;
  minAmount: number;
  maxAmount: number;
}

export interface FirstDepositBonusSettings {
  ok?: boolean;
  firstDepositBonusEnabled: boolean;
  firstDepositBonusPercent: number;
}

export interface RobotsSummarySnapshot {
  totalRobots: number;
  activeRobots: number;
  disabledRobots: number;
  totalStake: number;
  totalWins: number;
  netPnl: number;
  gamesPlayed: number;
  activeGames: number;
}

export interface RobotsSnapshotResponse {
  ok: boolean;
  config: RobotConfigSnapshot;
  summary: RobotsSummarySnapshot;
  robots: RobotProfileRow[];
}

export type RobotActivityType =
  | 'join'
  | 'leave'
  | 'disable_leave'
  | 'round_started'
  | 'robot_bingo_claim'
  | 'round_resolved';

export interface RobotActivityEvent {
  type: RobotActivityType | string;
  robotId?: string;
  pseudoSocketId?: string;
  winnerRobotId?: string | null;
  cartelId?: number;
  gameId: string;
  roundId?: number;
  at: string;
  calledCount?: number;
  prize?: number;
  cartelIds?: number[];
}
