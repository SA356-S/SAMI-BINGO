import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';
import { prisma } from '../utils/prisma';

type EndpointStat = {
  count: number;
  successCount: number;
  failureCount: number;
  avgResponseTime: number;
};

type UsageLogRow = {
  endpoint: string;
  statusCode: number;
  responseTime: number;
  ip: string;
};

// In-memory cache for quick stats access
const statsCache = {
  totalRequests: 0,
  endpointStats: new Map<string, EndpointStat>(),
  ipStats: new Map<string, number>(),
};

function buildStatsFromLogs(logs: UsageLogRow[]) {
  const endpointStats = new Map<string, EndpointStat>();
  const ipStats = new Map<string, number>();

  for (const log of logs) {
    const endpointKey = log.endpoint;

    const current = endpointStats.get(endpointKey) ?? {
      count: 0,
      successCount: 0,
      failureCount: 0,
      avgResponseTime: 0,
    };

    current.count += 1;
    if (log.statusCode < 400) {
      current.successCount += 1;
    } else {
      current.failureCount += 1;
    }
    current.avgResponseTime =
      (current.avgResponseTime * (current.count - 1) + log.responseTime) / current.count;

    endpointStats.set(endpointKey, current);
    ipStats.set(log.ip, (ipStats.get(log.ip) ?? 0) + 1);
  }

  return { endpointStats, ipStats };
}

function mapToRecord<T>(map: Map<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  map.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

async function loadUsageStatsFromDb() {
  const [totalRequests, logs] = await Promise.all([
    prisma.usageLog.count(),
    prisma.usageLog.findMany({
      select: {
        endpoint: true,
        statusCode: true,
        responseTime: true,
        ip: true,
      },
    }),
  ]);

  const { endpointStats, ipStats } = buildStatsFromLogs(logs);

  return {
    totalRequests,
    endpointStats,
    ipStats,
  };
}

// Initialize cache from database on startup
export const initializeStatsCache = async () => {
  try {
    const stats = await loadUsageStatsFromDb();
    statsCache.totalRequests = stats.totalRequests;
    statsCache.endpointStats = stats.endpointStats;
    statsCache.ipStats = stats.ipStats;
    logger.info('Stats cache initialized from database');
  } catch (error) {
    logger.error('Error initializing stats cache:', error);
  }
};

export const requestLogger = (req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  const requestId = Math.random().toString(36).substring(2, 15);

  // Log request details
  logger.info(`[${requestId}] Incoming ${req.method} request to ${req.originalUrl}`, {
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    userAgent: req.get('user-agent'),
    body: req.method === 'POST' ? JSON.stringify(req.body) : undefined,
    query: Object.keys(req.query).length ? req.query : undefined,
    apiKeyOwner: (req as any).apiKeyData ? (req as any).apiKeyData.owner : 'none',
  });

  // Update in-memory cache for quick access
  statsCache.totalRequests++;

  // Track by endpoint
  const endpoint = `${req.method} ${req.originalUrl.split('?')[0]}`;
  if (!statsCache.endpointStats.has(endpoint)) {
    statsCache.endpointStats.set(endpoint, {
      count: 0,
      successCount: 0,
      failureCount: 0,
      avgResponseTime: 0,
    });
  }
  const endpointStat = statsCache.endpointStats.get(endpoint)!;
  endpointStat.count++;

  // Track by IP address
  const ipCount = statsCache.ipStats.get(req.ip ?? '') || 0;
  statsCache.ipStats.set(req.ip ?? '', ipCount + 1);

  // Use the 'finish' event to capture response completion
  res.on('finish', async () => {
    const responseTime = Date.now() - start;
    const endpointStat = statsCache.endpointStats.get(endpoint)!;

    if (res.statusCode < 400) {
      endpointStat.successCount++;
    } else {
      endpointStat.failureCount++;
    }

    endpointStat.avgResponseTime =
      (endpointStat.avgResponseTime * (endpointStat.count - 1) + responseTime) /
      endpointStat.count;

    // Get a safe representation of the key for logging (prefix or legacy substring)
    const keyDetails = (req as any).apiKeyData;
    const safeKeyLog = keyDetails
      ? keyDetails.prefix ||
        (keyDetails.key ? keyDetails.key.substring(0, 8) : 'unknown')
      : 'none';

    logger.info(
      `[${requestId}] Response sent in ${responseTime}ms with status ${res.statusCode}`,
      {
        statusCode: res.statusCode,
        responseTime,
        contentLength: res.get('Content-Length') || 'unknown',
        apiKey: safeKeyLog,
      }
    );

    if (res.statusCode >= 400) {
      logger.warn(`[${requestId}] Error occurred with status ${res.statusCode}`);
    }

    // Store usage log in database if API key is present
    try {
      if ((req as any).apiKeyData) {
        await prisma.usageLog.create({
          data: {
            apiKeyId: (req as any).apiKeyData.id,
            endpoint,
            method: req.method,
            statusCode: res.statusCode,
            responseTime,
            ip: req.ip || 'unknown',
          },
        });
      }
    } catch (error) {
      logger.error('Error logging API usage:', error);
    }
  });

  next();
};

// Get usage statistics with cache fallback
export const getUsageStats = async () => {
  try {
    const stats = await loadUsageStatsFromDb();

    return {
      totalRequests: stats.totalRequests,
      endpointStats: mapToRecord(stats.endpointStats),
      ipStats: mapToRecord(stats.ipStats),
    };
  } catch (error) {
    logger.error('Error fetching usage stats from database:', error);

    // Fallback to in-memory cache if database query fails
    logger.info('Falling back to in-memory cache for stats');

    return {
      totalRequests: statsCache.totalRequests,
      endpointStats: mapToRecord(statsCache.endpointStats),
      ipStats: mapToRecord(statsCache.ipStats),
    };
  }
};
