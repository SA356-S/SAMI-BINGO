const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

process.env.QBIRR_API_KEY = 'test-qbirr-key';
process.env.QBIRR_BASE_URL = 'https://verify.qbirr.com';
process.env.DEPOSIT_TELEBIRR_ACCOUNTS =
  '0979596741:WASIHUN,0926202638:tamirat,0970779529:WASIHUN';
process.env.DEPOSIT_CBEBIRR_NUMBER = '0911223344';
process.env.DEPOSIT_CBEBIRR_RECEIVER_NAME = 'CAPITAL BINGO';
process.env.DEPOSIT_CBEBIRR_ACCOUNT = '1000017692643';

const {
  parseTelebirrAccounts,
  resolveReceiver,
  phoneKey,
} = require('../src/config/depositAccounts');
const { verifyWithQbirr } = require('../src/services/qbirrClient');
const { verifyAndCreditDeposit, extractTelebirrReference, extractReceiptAmountHint } = require('../src/services/depositVerificationService');
const depositRoutes = require('../src/routes/depositRoutes');
const botDepositRoutes = require('../src/routes/botDepositRoutes');
const depositHandler = require('../src/bot/handlers/depositHandler');

function createMemoryDeps(qbirrImpl, wallets) {
  const deposits = new Map();
  const qbirrCalls = [];

  return {
    deposits,
    qbirrCalls,
    applyFirstDepositBonus: false,
    verifyQbirr: async (payload) => {
      qbirrCalls.push(payload);
      return qbirrImpl(payload);
    },
    findByReference: async (ref) => deposits.get(ref) || null,
    insertPending: async (doc) => {
      if (deposits.has(doc.transactionId)) {
        const err = new Error('duplicate');
        err.code = 11000;
        throw err;
      }
      const row = {
        ...doc,
        _id: doc.transactionId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      deposits.set(doc.transactionId, row);
      return { ...row };
    },
    markStatus: async (ref, set) => {
      const row = deposits.get(ref);
      if (!row) return null;
      Object.assign(row, set, { updatedAt: new Date() });
      return { ...row };
    },
    claimForCredit: async (ref) => {
      const row = deposits.get(ref);
      if (!row || row.walletCredited || row.status === 'approved') return null;
      row.status = 'pending';
      return { ...row };
    },
    creditWallet: async (userId, amount) => {
      const current = wallets.get(userId) || { play: 0, main: 0 };
      current.play += amount;
      wallets.set(userId, current);
      return { ok: true, wallet: { ...current }, credited: amount };
    },
    recordTx: async () => null,
    getWallet: async (userId) => {
      const current = wallets.get(userId) || { play: 0, main: 0 };
      return { playWallet: current.play, mainWallet: current.main };
    },
  };
}

beforeEach(() => {
  process.env.DEPOSIT_TELEBIRR_ACCOUNTS =
    '0979596741:WASIHUN,0926202638:tamirat,0970779529:WASIHUN';
  process.env.DEPOSIT_CBEBIRR_RECEIVER_NAME = 'CAPITAL BINGO';
  process.env.DEPOSIT_CBEBIRR_ACCOUNT = '1000017692643';
});

test('Test 8: Telebirr number/name mapping is parsed per number', () => {
  const map = parseTelebirrAccounts(
    '0979596741:WASIHUN,0926202638:tamirat,0970779529:WASIHUN'
  );
  assert.equal(map.get(phoneKey('0979596741')).receiverName, 'WASIHUN');
  assert.equal(map.get(phoneKey('0926202638')).receiverName, 'tamirat');
  assert.equal(map.get(phoneKey('0970779529')).receiverName, 'WASIHUN');
  assert.notEqual(
    [...map.values()].map((a) => a.receiverName).join(','),
    'WASIHUN,WASIHUN,tamirat'
  );
});

test('Test 9: CBE uses server-side receiver name and account', () => {
  const resolved = resolveReceiver('cbe');
  assert.equal(resolved.ok, true);
  assert.equal(resolved.receiverName, 'CAPITAL BINGO');
  assert.equal(resolved.receiverAccount, '1000017692643');
  assert.equal(resolved.receivingNumber, '0911223344');
});

test('qbirr client sends provider, ref, amount, receiver_name, and CBE receiver_account', async () => {
  let sent;
  const result = await verifyWithQbirr(
    {
      provider: 'cbe',
      ref: 'FT23001234ABC',
      amount: 500,
      receiver_name: 'CAPITAL BINGO',
      receiver_account: '1000017692643',
    },
    async (url, options) => {
      sent = { url, options };
      return {
        ok: true,
        status: 200,
        json: async () => ({ verified: true, payer: 'JANE', amount: 500, error: '' }),
      };
    }
  );

  assert.equal(result.ok, true);
  assert.match(sent.url, /https:\/\/verify\.qbirr\.com\/api\/v1\/verify/);
  assert.equal(sent.options.headers['X-API-Key'], 'test-qbirr-key');
  const body = JSON.parse(sent.options.body);
  assert.deepEqual(body, {
    provider: 'cbe',
    ref: 'FT23001234ABC',
    amount: 500,
    receiver_name: 'CAPITAL BINGO',
    receiver_account: '1000017692643',
  });
});

test('Test 1: valid Telebirr credits the wallet', async () => {
  const wallets = new Map();
  const deps = createMemoryDeps(async () => ({
    ok: true,
    qbirr: { verified: true, payer: 'ABEBE', amount: 500, error: '' },
  }), wallets);

  const result = await verifyAndCreditDeposit(
    {
      userId: '1001',
      provider: 'telebirr',
      receivingNumber: '0979596741',
      reference: 'CE123456789',
      amount: 500,
      source: 'miniapp',
    },
    deps
  );

  assert.equal(result.ok, true);
  assert.equal(result.verifiedAmount, 500);
  assert.equal(wallets.get('1001').play, 500);
  assert.equal(deps.qbirrCalls[0].provider, 'telebirr');
  assert.equal(deps.qbirrCalls[0].receiver_name, 'WASIHUN');
  assert.equal(deps.deposits.get('CE123456789').walletCredited, true);
});

test('Test 2: valid CBE Birr credits the wallet', async () => {
  const wallets = new Map();
  const deps = createMemoryDeps(async (payload) => {
    assert.equal(payload.provider, 'cbe');
    assert.equal(payload.receiver_name, 'CAPITAL BINGO');
    assert.equal(payload.receiver_account, '1000017692643');
    return {
      ok: true,
      qbirr: { verified: true, payer: 'KEBEDE', amount: 250, error: '' },
    };
  }, wallets);

  const result = await verifyAndCreditDeposit(
    {
      userId: '1002',
      provider: 'cbe',
      reference: 'FT25001ABC',
      amount: 250,
      source: 'bot',
    },
    deps
  );

  assert.equal(result.ok, true);
  assert.equal(wallets.get('1002').play, 250);
});

test('Test 3: wrong amount is rejected and wallet is unchanged', async () => {
  const wallets = new Map([['1003', { play: 10, main: 0 }]]);
  const deps = createMemoryDeps(async () => ({
    ok: true,
    qbirr: { verified: true, payer: 'ABEBE', amount: 100, error: '' },
  }), wallets);

  const result = await verifyAndCreditDeposit(
    {
      userId: '1003',
      provider: 'telebirr',
      receivingNumber: '0926202638',
      reference: 'CE-WRONG-AMT',
      amount: 500,
      source: 'miniapp',
    },
    deps
  );

  assert.equal(result.ok, false);
  assert.equal(result.error, 'amount_mismatch');
  assert.equal(wallets.get('1003').play, 10);
});

test('Test 4: invalid reference is rejected before qbirr', async () => {
  const wallets = new Map([['1004', { play: 0, main: 0 }]]);
  const deps = createMemoryDeps(async () => {
    throw new Error('qbirr should not be called');
  }, wallets);

  const result = await verifyAndCreditDeposit(
    {
      userId: '1004',
      provider: 'telebirr',
      receivingNumber: '0979596741',
      reference: 'ab',
      amount: 100,
    },
    deps
  );

  assert.equal(result.ok, false);
  assert.equal(result.error, 'invalid_reference');
  assert.equal(deps.qbirrCalls.length, 0);
  assert.equal(wallets.get('1004').play, 0);
});

test('Test 5: qbirr verified=false does not credit the wallet', async () => {
  const wallets = new Map([['1005', { play: 40, main: 0 }]]);
  const deps = createMemoryDeps(async () => ({
    ok: true,
    qbirr: { verified: false, payer: '', amount: null, error: 'not found' },
  }), wallets);

  const result = await verifyAndCreditDeposit(
    {
      userId: '1005',
      provider: 'telebirr',
      receivingNumber: '0970779529',
      reference: 'CE-UNVERIFIED',
      amount: 80,
    },
    deps
  );

  assert.equal(result.ok, false);
  assert.equal(result.error, 'verification_failed');
  assert.equal(wallets.get('1005').play, 40);
});

test('Test 6: duplicate transaction reference does not credit twice', async () => {
  const wallets = new Map();
  const deps = createMemoryDeps(async () => ({
    ok: true,
    qbirr: { verified: true, payer: 'ABEBE', amount: 300, error: '' },
  }), wallets);

  const payload = {
    userId: '1006',
    provider: 'cbe',
    reference: 'FT-DUP-1',
    amount: 300,
    source: 'bot',
  };

  const first = await verifyAndCreditDeposit(payload, deps);
  const second = await verifyAndCreditDeposit({ ...payload, source: 'miniapp' }, deps);

  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  assert.equal(second.error, 'transaction_already_processed');
  assert.equal(wallets.get('1006').play, 300);
});

test('Test 7: unknown Telebirr number is rejected before qbirr', async () => {
  const wallets = new Map();
  const deps = createMemoryDeps(async () => {
    throw new Error('qbirr should not be called');
  }, wallets);

  const result = await verifyAndCreditDeposit(
    {
      userId: '1007',
      provider: 'telebirr',
      receivingNumber: '0900000000',
      reference: 'CE-UNKNOWN',
      amount: 50,
    },
    deps
  );

  assert.equal(result.ok, false);
  assert.equal(result.error, 'unknown_receiving_number');
  assert.equal(deps.qbirrCalls.length, 0);
  assert.equal(wallets.has('1007'), false);
});

test('Test 8b: qbirr receives the mapped Telebirr receiver name', async () => {
  const wallets = new Map();
  const deps = createMemoryDeps(async () => ({
    ok: true,
    qbirr: { verified: true, payer: 'ABEBE', amount: 75, error: '' },
  }), wallets);

  await verifyAndCreditDeposit(
    {
      userId: '1008',
      provider: 'telebirr',
      receivingNumber: '0926202638',
      reference: 'CE-TAMIRAT',
      amount: 75,
    },
    deps
  );

  assert.equal(deps.qbirrCalls[0].receiver_name, 'tamirat');
  assert.equal(deps.qbirrCalls[0].receiver_account, undefined);

  const second = createMemoryDeps(async () => ({
    ok: true,
    qbirr: { verified: true, payer: 'ABEBE', amount: 75, error: '' },
  }), wallets);

  await verifyAndCreditDeposit(
    {
      userId: '1008',
      provider: 'telebirr',
      receivingNumber: '0970779529',
      reference: 'CE-WASIHUN-2',
      amount: 75,
    },
    second
  );
  assert.equal(second.qbirrCalls[0].receiver_name, 'WASIHUN');
});

test('Test 10: bot and Mini App use the same backend verification service', () => {
  assert.equal(depositRoutes.verifyAndCreditDeposit, verifyAndCreditDeposit);
  assert.equal(botDepositRoutes.verifyAndCreditDeposit, verifyAndCreditDeposit);
  assert.equal(depositHandler.verifyAndCreditDeposit, verifyAndCreditDeposit);
});

test('Test 11: bot and Mini App credit the same MongoDB wallet', async () => {
  const wallets = new Map();
  const deps = createMemoryDeps(async (payload) => ({
    ok: true,
    qbirr: { verified: true, payer: 'ABEBE', amount: payload.amount, error: '' },
  }), wallets);

  const botResult = await verifyAndCreditDeposit(
    {
      userId: '2001',
      provider: 'telebirr',
      receivingNumber: '0979596741',
      reference: 'CE-BOT-500',
      amount: 500,
      source: 'bot',
    },
    deps
  );
  const appResult = await verifyAndCreditDeposit(
    {
      userId: '2001',
      provider: 'cbe',
      reference: 'FT-APP-500',
      amount: 500,
      source: 'miniapp',
    },
    deps
  );

  assert.equal(botResult.ok, true);
  assert.equal(appResult.ok, true);
  assert.equal(wallets.get('2001').play, 1000);
  assert.equal(botResult.playWallet, 500);
  assert.equal(appResult.playWallet, 1000);
});

test('frontend Mini App does not contain qbirr credentials or verify URLs', () => {
  const frontendRoot = path.join(__dirname, '../../frontend/src');
  const files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(js|jsx)$/.test(entry.name)) files.push(full);
    }
  }
  walk(frontendRoot);
  const joined = files.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
  assert.doesNotMatch(joined, /QBIRR_API_KEY/);
  assert.doesNotMatch(joined, /verify\.qbirr\.com/);
  assert.doesNotMatch(joined, /\/api\/v1\/verify/);
});

test('Telebirr SMS paste extracts reference and amount hint', () => {
  const sms = [
    'Dear Customer, you have transferred ETB 50.00 to WASIHUN',
    'Your transaction number is CKI5ABC12XY.',
    'Thank you for using telebirr!',
  ].join(' ');
  assert.equal(extractTelebirrReference(sms), 'CKI5ABC12XY');
  assert.equal(extractReceiptAmountHint(sms), 50);
});

test('Telebirr deposit without typed amount credits the qbirr verified amount', async () => {
  const wallets = new Map();
  const deps = createMemoryDeps(async (payload) => {
    assert.equal(payload.ref, 'CKI5ABC12XY');
    assert.equal(payload.amount, 50);
    return {
      ok: true,
      qbirr: { verified: true, payer: 'ABEBE', amount: 50, error: '' },
    };
  }, wallets);

  const result = await verifyAndCreditDeposit(
    {
      userId: '3001',
      provider: 'telebirr',
      receivingNumber: '0979596741',
      reference:
        'Dear Customer, you have transferred ETB 50.00. Transaction number is CKI5ABC12XY.',
      source: 'bot',
    },
    deps
  );

  assert.equal(result.ok, true);
  assert.equal(result.verifiedAmount, 50);
  assert.equal(wallets.get('3001').play, 50);
});
