const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

process.env.DEPOSIT_TELEBIRR_ACCOUNTS =
  process.env.DEPOSIT_TELEBIRR_ACCOUNTS ||
  '0979596741:WASIHUN,0926202638:tamirat,0970779529:WASIHUN';
process.env.DEPOSIT_CBEBIRR_NUMBER =
  process.env.DEPOSIT_CBEBIRR_NUMBER || '0911223344';
process.env.DEPOSIT_CBEBIRR_RECEIVER_NAME =
  process.env.DEPOSIT_CBEBIRR_RECEIVER_NAME || 'CAPITAL BINGO';
process.env.DEPOSIT_CBEBIRR_ACCOUNT =
  process.env.DEPOSIT_CBEBIRR_ACCOUNT || '1000017692643';

const {
  submitManualDeposit,
  approveManualDeposit,
  rejectManualDeposit,
  getManualDepositScreenshot,
  parseAmountFromText,
} = require('../src/services/manualDepositService');
const {
  formatManualDepositInstructions,
  photoFromMessage,
  handleManualDepositCommand,
  handleManualDepositPhoto,
  clearManualDepositState,
  MANUAL_DEPOSIT_UNAVAILABLE_MESSAGE,
} = require('../src/bot/handlers/manualDepositHandler');
const {
  BOT_COMMANDS,
  getActiveBotCommands,
  buildHelpMessage,
} = require('../src/bot/handlers/commandHandler');
const settingsService = require('../src/services/settingsService');
const { verifyAndCreditDeposit } = require('../src/services/depositVerificationService');

function createMemoryDeps() {
  const rows = new Map();
  let seq = 1;
  const wallets = new Map();
  const credits = [];
  const txns = [];
  const notifies = [];
  const qbirrCalls = [];

  return {
    qbirrCalls,
    credits,
    txns,
    notifies,
    wallets,
    async create(doc) {
      const pending = [...rows.values()].find(
        (row) => row.userId === doc.userId && row.status === 'pending'
      );
      if (pending) {
        const err = new Error('duplicate');
        err.code = 11000;
        throw err;
      }
      const id = `md${seq++}`;
      const row = {
        ...doc,
        _id: id,
        id,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      rows.set(id, row);
      return { ...row };
    },
    async findPendingByUser(userId) {
      return (
        [...rows.values()].find(
          (row) => row.userId === String(userId) && row.status === 'pending'
        ) || null
      );
    },
    async claimApprove(id, set) {
      const row = rows.get(id);
      if (!row || row.status !== 'pending' || row.walletCredited) return null;
      Object.assign(row, set, { updatedAt: new Date() });
      return { ...row };
    },
    async revertToPending(id) {
      const row = rows.get(id);
      if (!row || row.status !== 'approved' || row.walletCredited) return null;
      row.status = 'pending';
      row.approvedAmount = null;
      row.reviewedAt = null;
      row.reviewedByTelegramId = '';
      row.reviewedByRole = '';
      return { ...row };
    },
    async markWalletCredited(id) {
      const row = rows.get(id);
      if (!row || row.status !== 'approved' || row.walletCredited) return null;
      row.walletCredited = true;
      return { ...row };
    },
    async claimReject(id, set) {
      const row = rows.get(id);
      if (!row || row.status !== 'pending') return null;
      Object.assign(row, set, { updatedAt: new Date() });
      return { ...row };
    },
    async findById(id) {
      const row = rows.get(id);
      return row ? { ...row } : null;
    },
    async creditWallet(userId, amount) {
      credits.push({ userId, amount });
      const current = wallets.get(userId) || { play: 0, main: 0 };
      current.play += amount;
      wallets.set(userId, current);
      return { ok: true, wallet: { ...current }, credited: amount };
    },
    async recordTx(userId, row) {
      txns.push({ userId, ...row });
      return row;
    },
    async notifyUser(userId, text) {
      notifies.push({ userId, text });
      return true;
    },
    async downloadFile(fileId) {
      return {
        ok: true,
        buffer: Buffer.from(`photo:${fileId}`),
        contentType: 'image/jpeg',
      };
    },
    async isEnabled() {
      return true;
    },
    async verifyQbirr() {
      qbirrCalls.push(true);
      throw new Error('qbirr must not be called for manual deposits');
    },
  };
}

test('Manual Deposit is added to the Telegram command list without renaming existing commands', () => {
  const commands = BOT_COMMANDS.map((item) => item.command);
  assert.deepEqual(
    commands.filter((name) => name !== 'manualdeposit'),
    [
      'start',
      'register',
      'play',
      'deposit',
      'balance',
      'withdraw',
      'invite',
      'instruction',
      'support',
    ]
  );
  const manual = BOT_COMMANDS.find((item) => item.command === 'manualdeposit');
  assert.equal(manual.description, 'Manual Deposit');
  assert.equal(BOT_COMMANDS.find((item) => item.command === 'play')?.description, 'Play');
  assert.equal(BOT_COMMANDS.find((item) => item.command === 'deposit')?.description, 'Deposit');
});

test('manual deposit instructions reuse existing Telebirr/CBE account information', () => {
  const card = formatManualDepositInstructions();
  assert.match(card, /Manual Deposit/);
  assert.match(card, /Telebirr|CBEBirr/);
  assert.match(card, /screenshot/i);
  assert.doesNotMatch(card, /qbirr/i);
});

test('photoFromMessage stores the largest Telegram photo file_id', () => {
  const photo = photoFromMessage({
    photo: [
      { file_id: 'small', width: 10, height: 10, file_unique_id: 'a' },
      { file_id: 'large', width: 800, height: 600, file_unique_id: 'b' },
    ],
    caption: '100 ETB',
  });
  assert.equal(photo.fileId, 'large');
  assert.equal(photo.fileUniqueId, 'b');
  assert.equal(photo.caption, '100 ETB');
  assert.equal(parseAmountFromText(photo.caption), 100);
});

test('submitting a manual deposit stores pending data and does not credit the wallet', async () => {
  const deps = createMemoryDeps();
  const result = await submitManualDeposit(
    {
      userId: '111',
      telegramUsername: 'player1',
      telegramFirstName: 'Abebe',
      submittedAmount: 75,
      photoFileId: 'AgFILE123',
      photoCaption: '75 birr',
    },
    deps
  );

  assert.equal(result.ok, true);
  assert.equal(result.request.status, 'pending');
  assert.equal(result.request.userId, '111');
  assert.equal(result.request.telegramUsername, 'player1');
  assert.equal(result.request.photoFileId, 'AgFILE123');
  assert.equal(result.request.submittedAmount, 75);
  assert.equal(result.request.walletCredited, false);
  assert.equal(deps.credits.length, 0);
  assert.equal(deps.qbirrCalls.length, 0);
  assert.ok(result.request.createdAt);
});

test('a second pending manual deposit from the same user is rejected', async () => {
  const deps = createMemoryDeps();
  await submitManualDeposit(
    { userId: '111', photoFileId: 'file-a' },
    deps
  );
  const second = await submitManualDeposit(
    { userId: '111', photoFileId: 'file-b' },
    deps
  );
  assert.equal(second.ok, false);
  assert.equal(second.error, 'already_pending');
  assert.equal(deps.credits.length, 0);
});

test('approve credits the admin-verified amount exactly once and notifies the user', async () => {
  const deps = createMemoryDeps();
  const created = await submitManualDeposit(
    { userId: '222', submittedAmount: 9999, photoFileId: 'file-c' },
    deps
  );

  const first = await approveManualDeposit(
    created.request.id,
    { amount: 50, actorTelegramId: 999, actorRole: 'admin' },
    deps
  );
  assert.equal(first.ok, true);
  assert.equal(first.request.status, 'approved');
  assert.equal(first.credited, 50);
  assert.equal(deps.wallets.get('222').play, 50);
  assert.equal(deps.credits.length, 1);
  assert.equal(deps.txns[0].channel, 'MANUAL');
  assert.match(deps.notifies[0].text, /50/);
  assert.equal(first.request.reviewedByTelegramId, '999');
  assert.ok(first.request.reviewedAt);

  const second = await approveManualDeposit(
    created.request.id,
    { amount: 50, actorTelegramId: 999, actorRole: 'admin' },
    deps
  );
  assert.equal(second.ok, false);
  assert.equal(second.error, 'already_processed');
  assert.equal(deps.credits.length, 1);
  assert.equal(deps.wallets.get('222').play, 50);
  assert.equal(deps.qbirrCalls.length, 0);
});

test('reject does not credit the wallet and notifies the user', async () => {
  const deps = createMemoryDeps();
  const created = await submitManualDeposit(
    { userId: '333', submittedAmount: 80, photoFileId: 'file-d' },
    deps
  );

  const rejected = await rejectManualDeposit(
    created.request.id,
    { actorTelegramId: 1, actorRole: 'manager' },
    deps
  );
  assert.equal(rejected.ok, true);
  assert.equal(rejected.request.status, 'rejected');
  assert.equal(deps.credits.length, 0);
  assert.equal(deps.wallets.get('333'), undefined);
  assert.match(deps.notifies[0].text, /rejected/i);

  const again = await rejectManualDeposit(
    created.request.id,
    { actorTelegramId: 1, actorRole: 'manager' },
    deps
  );
  assert.equal(again.ok, false);
  assert.equal(again.error, 'already_processed');
});

test('approve without an admin-verified amount does not credit', async () => {
  const deps = createMemoryDeps();
  const created = await submitManualDeposit(
    { userId: '444', submittedAmount: 40, photoFileId: 'file-e' },
    deps
  );
  const result = await approveManualDeposit(created.request.id, {}, deps);
  assert.equal(result.ok, false);
  assert.equal(result.error, 'amount_required');
  assert.equal(deps.credits.length, 0);
  assert.equal((await deps.findById(created.request.id)).status, 'pending');
});

test('screenshot proxy returns the stored Telegram file bytes', async () => {
  const deps = createMemoryDeps();
  const created = await submitManualDeposit(
    { userId: '555', photoFileId: 'file-shot' },
    deps
  );
  const shot = await getManualDepositScreenshot(created.request.id, deps);
  assert.equal(shot.ok, true);
  assert.equal(shot.contentType, 'image/jpeg');
  assert.equal(shot.buffer.toString(), 'photo:file-shot');
});

test('manual deposit service never requires qbirr or automatic verification', () => {
  const servicePath = path.resolve(__dirname, '../src/services/manualDepositService.js');
  const handlerPath = path.resolve(__dirname, '../src/bot/handlers/manualDepositHandler.js');
  const serviceSrc = fs.readFileSync(servicePath, 'utf8');
  const handlerSrc = fs.readFileSync(handlerPath, 'utf8');
  assert.doesNotMatch(serviceSrc, /require\(['"][^'"]*qbirr/i);
  assert.doesNotMatch(serviceSrc, /require\(['"][^'"]*depositVerificationService/);
  assert.doesNotMatch(handlerSrc, /require\(['"][^'"]*qbirr/i);
  assert.doesNotMatch(handlerSrc, /verifyAndCreditDeposit/);
});

test('Manual Deposit setting persists ON/OFF in the existing settings service', async () => {
  const original = settingsService.getManualDepositSettingsSync().manualDepositEnabled;
  try {
    const on = await settingsService.updateManualDepositSettings({ enabled: true });
    assert.equal(on.manualDepositEnabled, true);
    const off = await settingsService.updateManualDepositSettings({ enabled: false });
    assert.equal(off.manualDepositEnabled, false);
    assert.equal(settingsService.getManualDepositSettingsSync().manualDepositEnabled, false);
    const loaded = await settingsService.getManualDepositSettings();
    assert.equal(loaded.manualDepositEnabled, false);
  } finally {
    await settingsService.updateManualDepositSettings({ enabled: original !== false });
  }
});

test('submit succeeds when Manual Deposit is ON and is rejected when OFF', async () => {
  const deps = createMemoryDeps();
  const on = await submitManualDeposit(
    { userId: 'on-user', photoFileId: 'file-on' },
    deps
  );
  assert.equal(on.ok, true);
  assert.equal(on.request.status, 'pending');

  deps.isEnabled = async () => false;
  const off = await submitManualDeposit(
    { userId: 'off-user', photoFileId: 'file-off' },
    deps
  );
  assert.equal(off.ok, false);
  assert.equal(off.error, 'manual_deposit_disabled');
  assert.equal(await deps.findPendingByUser('off-user'), null);
});

test('approve still works while Manual Deposit is OFF', async () => {
  const deps = createMemoryDeps();
  const created = await submitManualDeposit(
    { userId: 'keep-approve', submittedAmount: 40, photoFileId: 'file-keep' },
    deps
  );
  deps.isEnabled = async () => false;
  const approved = await approveManualDeposit(
    created.request.id,
    { amount: 40, actorTelegramId: 9, actorRole: 'admin' },
    deps
  );
  assert.equal(approved.ok, true);
  assert.equal(approved.credited, 40);
  assert.equal(deps.wallets.get('keep-approve').play, 40);
});

test('direct /manualdeposit is rejected while OFF and starts the existing flow while ON', async () => {
  await settingsService.updateManualDepositSettings({ enabled: true });
  const onReplies = [];
  await handleManualDepositCommand({
    from: { id: 7001 },
    reply: async (text) => {
      onReplies.push(text);
    },
  });
  assert.match(onReplies[0], /Manual Deposit/);
  clearManualDepositState(7001);

  await settingsService.updateManualDepositSettings({ enabled: false });
  try {
    const offReplies = [];
    await handleManualDepositCommand({
      from: { id: 7002 },
      reply: async (text) => {
        offReplies.push(text);
      },
    });
    assert.equal(offReplies[0], MANUAL_DEPOSIT_UNAVAILABLE_MESSAGE);
    assert.match(offReplies[0], /temporarily unavailable/i);
    assert.match(offReplies[0], /\/deposit/);
  } finally {
    await settingsService.updateManualDepositSettings({ enabled: true });
  }
});

test('in-progress photo is not stored when Manual Deposit is turned OFF', async () => {
  await settingsService.updateManualDepositSettings({ enabled: true });
  await handleManualDepositCommand({
    from: { id: 7003 },
    reply: async () => {},
  });
  await settingsService.updateManualDepositSettings({ enabled: false });
  try {
    const replies = [];
    const handled = await handleManualDepositPhoto({
      from: { id: 7003 },
      reply: async (text) => {
        replies.push(text);
      },
      message: {
        photo: [{ file_id: 'should-not-save', width: 100, height: 100 }],
      },
    });
    assert.equal(handled, true);
    assert.equal(replies[0], MANUAL_DEPOSIT_UNAVAILABLE_MESSAGE);
  } finally {
    await settingsService.updateManualDepositSettings({ enabled: true });
    clearManualDepositState(7003);
  }
});

test('Telegram command list and help hide manualdeposit when OFF', async () => {
  await settingsService.updateManualDepositSettings({ enabled: false });
  try {
    const commands = await getActiveBotCommands();
    assert.equal(
      commands.some((item) => item.command === 'manualdeposit'),
      false
    );
    assert.ok(commands.some((item) => item.command === 'deposit'));
    const help = buildHelpMessage(false);
    assert.doesNotMatch(help, /manualdeposit/);
  } finally {
    await settingsService.updateManualDepositSettings({ enabled: true });
  }
  const onCommands = await getActiveBotCommands();
  assert.ok(onCommands.some((item) => item.command === 'manualdeposit'));
  assert.match(buildHelpMessage(true), /manualdeposit/);
});

test('automatic Telebirr deposit still credits when Manual Deposit is OFF', async () => {
  await settingsService.updateManualDepositSettings({ enabled: false });
  try {
    const wallets = new Map();
    const deposits = new Map();
    const qbirrCalls = [];
    const result = await verifyAndCreditDeposit(
      {
        userId: 'auto-off',
        provider: 'telebirr',
        receivingNumber: '0979596741',
        reference: 'CEMANUALOFF1',
        amount: 120,
        source: 'bot',
      },
      {
        applyFirstDepositBonus: false,
        verifyQbirr: async (payload) => {
          qbirrCalls.push(payload);
          return {
            ok: true,
            qbirr: { verified: true, payer: 'ABEBE', amount: 120, error: '' },
          };
        },
        findByReference: async (ref) => deposits.get(ref) || null,
        insertPending: async (doc) => {
          const row = {
            ...doc,
            _id: doc.transactionId,
            walletCredited: false,
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
      }
    );
    assert.equal(result.ok, true);
    assert.equal(result.verifiedAmount, 120);
    assert.equal(wallets.get('auto-off').play, 120);
    assert.equal(qbirrCalls[0].provider, 'telebirr');
  } finally {
    await settingsService.updateManualDepositSettings({ enabled: true });
  }
});

test('automatic deposit modules do not read the Manual Deposit flag', () => {
  const verificationSrc = fs.readFileSync(
    path.resolve(__dirname, '../src/services/depositVerificationService.js'),
    'utf8'
  );
  const depositHandlerSrc = fs.readFileSync(
    path.resolve(__dirname, '../src/bot/handlers/depositHandler.js'),
    'utf8'
  );
  const qbirrSrc = fs.readFileSync(
    path.resolve(__dirname, '../src/services/qbirrClient.js'),
    'utf8'
  );
  const bonusSrc = fs.readFileSync(
    path.resolve(__dirname, '../src/services/firstDepositBonusService.js'),
    'utf8'
  );
  for (const src of [verificationSrc, depositHandlerSrc, qbirrSrc, bonusSrc]) {
    assert.doesNotMatch(src, /manualDepositEnabled/);
    assert.doesNotMatch(src, /getManualDepositSettings/);
  }
});
