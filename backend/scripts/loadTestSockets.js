'use strict';

/**
 * Isolated Socket.IO fan-out load test (no Telegram, no wallets, no Mongo).
 *
 * Usage:
 *   node scripts/loadTestSockets.js
 *   node scripts/loadTestSockets.js --counts=100,200,300,400
 */

const http = require('http');
const { Server } = require('socket.io');
const { io: ioc } = require('socket.io-client');

const COUNTS = String(process.env.LOAD_TEST_COUNTS || '100,200,300,400')
  .split(',')
  .map((n) => Number(n.trim()))
  .filter((n) => Number.isFinite(n) && n > 0);

const ROOM = 'game:load-test';
const DRAW_COUNT = 20;

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function createMockIo(emits) {
  return {
    to() {
      return {
        emit(event, payload) {
          emits.push({ event, payload });
        },
      };
    },
  };
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function listenServer() {
  const httpServer = http.createServer();
  const io = new Server(httpServer, {
    cors: { origin: '*' },
    pingInterval: 25000,
    pingTimeout: 20000,
    perMessageDeflate: false,
    connectionStateRecovery: {
      maxDisconnectionDuration: 120000,
      skipMiddlewares: true,
    },
  });

  io.on('connection', (socket) => {
    socket.on('join', (ack) => {
      socket.join(ROOM);
      if (typeof ack === 'function') ack({ ok: true });
    });
    socket.on('error', () => {});
  });

  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const { port } = httpServer.address();
  return { httpServer, io, url: `http://127.0.0.1:${port}` };
}

async function runScenario(io, url, clientCount) {
  const memBefore = process.memoryUsage();
  const cpuBefore = process.cpuUsage();
  const startedAt = Date.now();

  const clients = [];
  const connectMs = [];
  let connectFail = 0;
  let eventDupes = 0;
  let ballDupes = 0;
  const latencies = [];

  for (let i = 0; i < clientCount; i += 1) {
    const t0 = Date.now();
    const socket = ioc(url, {
      transports: ['websocket'],
      reconnection: false,
      timeout: 8000,
      forceNew: true,
    });
    clients.push(socket);
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('connect_timeout')), 8000);
        socket.once('connect', () => {
          clearTimeout(timer);
          connectMs.push(Date.now() - t0);
          resolve();
        });
        socket.once('connect_error', (err) => {
          clearTimeout(timer);
          reject(err);
        });
      });
      await new Promise((resolve) => socket.emit('join', () => resolve()));
    } catch {
      connectFail += 1;
    }
  }

  const seenByClient = clients.map(() => []);
  clients.forEach((socket, idx) => {
    socket.on('newNumber', (payload) => {
      const arrived = Date.now();
      if (payload?.sentAt) latencies.push(arrived - payload.sentAt);
      const list = seenByClient[idx];
      if (list.includes(payload.number)) ballDupes += 1;
      if (list.some((n, i) => list[i] === payload.sequence && n !== payload.number)) {
        eventDupes += 1;
      }
      list.push(payload.number);
    });
  });

  await sleep(50);

  const called = new Set();
  for (let seq = 1; seq <= DRAW_COUNT; seq += 1) {
    let next = null;
    for (let n = 1; n <= 75; n += 1) {
      if (!called.has(n)) {
        next = n;
        break;
      }
    }
    if (next == null) break;
    called.add(next);
    io.to(ROOM).emit('newNumber', {
      number: next,
      sequence: seq,
      sentAt: Date.now(),
      gameId: 'load-test',
    });
    await sleep(15);
  }

  await sleep(400);

  let reconnectOk = 0;
  let reconnectFail = 0;
  const sample = clients.filter((s) => s.connected).slice(0, Math.min(25, clients.length));
  await Promise.all(
    sample.map(
      (socket) =>
        new Promise((resolve) => {
          const timer = setTimeout(() => {
            reconnectFail += 1;
            resolve();
          }, 5000);
          socket.once('connect', () => {
            clearTimeout(timer);
            reconnectOk += 1;
            resolve();
          });
          socket.disconnect();
          socket.connect();
        })
    )
  );

  const connected = clients.filter((s) => s.connected).length;
  const receivedFull = seenByClient.filter((list) => list.length === DRAW_COUNT).length;
  const uniqueOk = seenByClient.filter(
    (list) => list.length === new Set(list).size
  ).length;

  for (const socket of clients) {
    socket.removeAllListeners();
    socket.close();
  }

  const cpu = process.cpuUsage(cpuBefore);
  const memAfter = process.memoryUsage();
  latencies.sort((a, b) => a - b);
  connectMs.sort((a, b) => a - b);

  return {
    clients: clientCount,
    connected,
    connectFail,
    connectSuccessRate: Number((((clientCount - connectFail) / clientCount) * 100).toFixed(1)),
    receivedFull,
    uniqueHistories: uniqueOk,
    ballDupes,
    eventDupes,
    reconnectSample: sample.length,
    reconnectOk,
    reconnectFail,
    latencyMs: {
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      p99: percentile(latencies, 99),
      max: latencies[latencies.length - 1] || 0,
    },
    connectMs: {
      p50: percentile(connectMs, 50),
      p95: percentile(connectMs, 95),
      max: connectMs[connectMs.length - 1] || 0,
    },
    cpuUserMs: Math.round(cpu.user / 1000),
    cpuSystemMs: Math.round(cpu.system / 1000),
    rssDeltaMb: Number(((memAfter.rss - memBefore.rss) / 1024 / 1024).toFixed(1)),
    heapUsedMb: Number((memAfter.heapUsed / 1024 / 1024).toFixed(1)),
    elapsedMs: Date.now() - startedAt,
  };
}

async function main() {
  const { GameSession } = require('../src/socket/gameManager');
  const session = new GameSession('LOAD-UNIT');
  session.status = 'calling';
  session._drawLoopToken = 1;
  const unitEmits = [];
  for (let i = 0; i < 75; i += 1) {
    session.callNextBall(createMockIo(unitEmits), 1);
  }
  const unitNumbers = session.calledNumbers;
  const unitUnique = new Set(unitNumbers).size;
  console.log('[load-test] in-memory draw uniqueness', {
    drawn: unitNumbers.length,
    unique: unitUnique,
    duplicateRejected: unitUnique === unitNumbers.length,
  });

  const { httpServer, io, url } = await listenServer();
  console.log('[load-test] listening', url);

  const results = [];
  try {
    for (const count of COUNTS) {
      console.log(`[load-test] running ${count} concurrent clients…`);
      const result = await runScenario(io, url, count);
      results.push(result);
      console.log('[load-test] result', result);
      global.gc?.();
      await sleep(500);
    }
  } finally {
    io.close();
    await new Promise((resolve) => httpServer.close(resolve));
  }

  const safe = [...results].reverse().find(
    (r) =>
      r.connectFail === 0 &&
      r.ballDupes === 0 &&
      r.receivedFull === r.clients &&
      r.reconnectFail === 0
  );
  console.log('[load-test] summary', {
    results,
    provenSafeCapacity: safe ? safe.clients : 0,
    note:
      'Capacity is for Socket.IO fan-out on this machine, not Railway/Mongo/Telegram. Real gameplay also includes robot eval, lobby ticks, and wallet I/O.',
  });
}

main().catch((err) => {
  console.error('[load-test] failed', err);
  process.exitCode = 1;
});
