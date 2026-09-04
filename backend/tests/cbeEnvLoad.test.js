const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

const { loadEnv } = require('../src/config/env');
const { normalizeEnv } = require('../src/config/normalizeEnv');
const {
  getCbeConfig,
  getPublicDepositMethods,
  displayFirstName,
} = require('../src/config/depositAccounts');
const { formatCbeInstructions } = require('../src/bot/handlers/depositHandler');
const {
  verifyAndCreditDeposit,
} = require('../src/services/depositVerificationService');

function restoreEnv(prev) {
  for (const [key, value] of Object.entries(prev)) {
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
}

test('CBE aliases DEPOSIT_CBE_NUMBER and DEPOSIT_CBE_RECEIVER_NAME enable CBE', () => {
  const prev = {
    DEPOSIT_CBEBIRR_NUMBER: process.env.DEPOSIT_CBEBIRR_NUMBER,
    DEPOSIT_CBEBIRR_RECEIVER_NAME: process.env.DEPOSIT_CBEBIRR_RECEIVER_NAME,
    DEPOSIT_CBEBIRR_ACCOUNT: process.env.DEPOSIT_CBEBIRR_ACCOUNT,
    DEPOSIT_CBE_NUMBER: process.env.DEPOSIT_CBE_NUMBER,
    DEPOSIT_CBE_RECEIVER_NAME: process.env.DEPOSIT_CBE_RECEIVER_NAME,
  };
  delete process.env.DEPOSIT_CBEBIRR_NUMBER;
  delete process.env.DEPOSIT_CBEBIRR_RECEIVER_NAME;
  delete process.env.DEPOSIT_CBEBIRR_ACCOUNT;
  process.env.DEPOSIT_CBE_NUMBER = '0904165498';
  process.env.DEPOSIT_CBE_RECEIVER_NAME = 'WASIHUN ADUGNA GETAHUN';
  normalizeEnv();
  const cbe = getCbeConfig();
  const methods = getPublicDepositMethods();
  const card = formatCbeInstructions(methods.cbe);
  restoreEnv(prev);
  assert.equal(cbe.configured, true);
  assert.equal(cbe.number, '0904165498');
  assert.equal(cbe.receiverName, 'WASIHUN ADUGNA GETAHUN');
  assert.equal(methods.cbe.enabled, true);
  assert.match(card, /0904165498/);
  assert.match(card, /Name:<\/b> WASIHUN/);
  assert.doesNotMatch(card, /WASIHUN ADUGNA GETAHUN/);
});

test('loadEnv reads backend/.env and CBE aliases from that file', () => {
  const envPath = path.resolve(__dirname, '../.env');
  const parsed = dotenv.parse(fs.readFileSync(envPath));
  const cbeKeys = [
    'DEPOSIT_CBEBIRR_NUMBER',
    'DEPOSIT_CBEBIRR_RECEIVER_NAME',
    'DEPOSIT_CBEBIRR_ACCOUNT',
    'DEPOSIT_CBEBIRR_ACCOUNTS',
    'DEPOSIT_CBE_NUMBER',
    'DEPOSIT_CBE_RECEIVER_NAME',
    'DEPOSIT_CBE_ACCOUNT',
    'DEPOSIT_CBE_ACCOUNTS',
    'CBEBIRR_NUMBER',
    'CBE_NUMBER',
    'CBE_PHONE',
    'CBEBIRR_RECEIVER_NAME',
    'CBE_RECEIVER_NAME',
    'CBE_NAME',
    'CBEBIRR_ACCOUNT',
    'CBE_ACCOUNT',
  ];
  const prev = {};
  for (const key of cbeKeys) {
    prev[key] = process.env[key];
    delete process.env[key];
  }

  loadEnv();

  const number = String(
    parsed.DEPOSIT_CBEBIRR_NUMBER ||
      parsed.DEPOSIT_CBE_NUMBER ||
      parsed.CBEBIRR_NUMBER ||
      parsed.CBE_NUMBER ||
      parsed.CBE_PHONE ||
      ''
  ).trim();
  const name = String(
    parsed.DEPOSIT_CBEBIRR_RECEIVER_NAME ||
      parsed.DEPOSIT_CBE_RECEIVER_NAME ||
      parsed.CBEBIRR_RECEIVER_NAME ||
      parsed.CBE_RECEIVER_NAME ||
      parsed.CBE_NAME ||
      ''
  ).trim();

  const cbe = getCbeConfig();
  const methods = getPublicDepositMethods();
  restoreEnv(prev);

  assert.ok(
    String(parsed.DEPOSIT_TELEBIRR_ACCOUNTS || '').trim(),
    'backend/.env Telebirr accounts must load'
  );

  if (number && name) {
    assert.equal(cbe.configured, true);
    assert.ok(cbe.number);
    assert.ok(cbe.receiverName);
    assert.equal(methods.cbe.enabled, true);
    const card = formatCbeInstructions({
      number: cbe.number,
      account: cbe.receiverAccount,
      receiverName: cbe.receiverName,
    });
    const firstName = displayFirstName(cbe.receiverName);
    assert.match(card, new RegExp(cbe.number.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(card, new RegExp(firstName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    if (cbe.receiverName !== firstName) {
      assert.doesNotMatch(card, new RegExp(cbe.receiverName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
    return;
  }

  assert.equal(cbe.configured, false);
});

test('CBE SMS paste still uses verifyAndCreditDeposit and credits once', async () => {
  const prev = {
    DEPOSIT_CBEBIRR_NUMBER: process.env.DEPOSIT_CBEBIRR_NUMBER,
    DEPOSIT_CBEBIRR_RECEIVER_NAME: process.env.DEPOSIT_CBEBIRR_RECEIVER_NAME,
    DEPOSIT_CBEBIRR_ACCOUNT: process.env.DEPOSIT_CBEBIRR_ACCOUNT,
  };
  process.env.DEPOSIT_CBEBIRR_NUMBER = '0904165498';
  process.env.DEPOSIT_CBEBIRR_RECEIVER_NAME = 'WASIHUN ADUGNA GETAHUN';
  process.env.DEPOSIT_CBEBIRR_ACCOUNT = '0904165498';

  const wallets = new Map();
  const deposits = new Map();
  const deps = {
    applyFirstDepositBonus: false,
    verifyQbirr: async (payload) => {
      assert.equal(payload.provider, 'cbe');
      assert.equal(payload.ref, 'FTENVLOAD01');
      return {
        ok: true,
        qbirr: { verified: true, payer: 'TEST', amount: 80, error: '' },
      };
    },
    findByReference: async (ref) => deposits.get(ref) || null,
    insertPending: async (doc) => {
      const row = { ...doc, _id: doc.transactionId, walletCredited: false };
      deposits.set(doc.transactionId, row);
      return row;
    },
    markStatus: async (ref, set) => {
      Object.assign(deposits.get(ref), set);
      return deposits.get(ref);
    },
    claimForCredit: async (ref) => {
      const row = deposits.get(ref);
      if (!row || row.walletCredited) return null;
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

  const result = await verifyAndCreditDeposit(
    {
      userId: '9101',
      provider: 'cbe',
      reference:
        'Dear Customer, you have transferred ETB 80.00. Transaction number is FTENVLOAD01.',
      source: 'bot',
    },
    deps
  );
  const second = await verifyAndCreditDeposit(
    {
      userId: '9101',
      provider: 'cbe',
      reference: 'FTENVLOAD01',
      amount: 80,
      source: 'miniapp',
    },
    {
      ...deps,
      verifyQbirr: async () => {
        throw new Error('should not verify twice');
      },
      creditWallet: async () => {
        throw new Error('should not credit twice');
      },
    }
  );
  restoreEnv(prev);
  assert.equal(result.ok, true);
  assert.equal(wallets.get('9101').play, 80);
  assert.equal(second.ok, false);
  assert.equal(second.error, 'transaction_already_processed');
});
