const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.DEPOSIT_TELEBIRR_ACCOUNTS =
  '0979596741:WASIHUN,0926202638:tamirat,0970779529:WASIHUN';
process.env.DEPOSIT_TELEBIRR_ROTATION_HOURS = '4';

const {
  getRotatedTelebirrAccount,
  phoneKey,
} = require('../src/config/depositAccounts');

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

test('bot Telebirr number stays the same within a 4-hour window', () => {
  const first = getRotatedTelebirrAccount(0);
  const sameWindow = getRotatedTelebirrAccount(FOUR_HOURS_MS - 1);
  assert.equal(phoneKey(first.number), phoneKey(sameWindow.number));
});

test('bot Telebirr number rotates when the 4-hour window advances', () => {
  const slot0 = getRotatedTelebirrAccount(0);
  const slot1 = getRotatedTelebirrAccount(FOUR_HOURS_MS);
  const slot2 = getRotatedTelebirrAccount(FOUR_HOURS_MS * 2);
  const slot3 = getRotatedTelebirrAccount(FOUR_HOURS_MS * 3);

  assert.notEqual(phoneKey(slot0.number), phoneKey(slot1.number));
  assert.notEqual(phoneKey(slot1.number), phoneKey(slot2.number));
  assert.equal(phoneKey(slot0.number), phoneKey(slot3.number));
});

test('rotated Telebirr numbers come from DEPOSIT_TELEBIRR_ACCOUNTS only', () => {
  const allowed = new Set(['0979596741', '0926202638', '0970779529'].map(phoneKey));
  for (let slot = 0; slot < 6; slot += 1) {
    const account = getRotatedTelebirrAccount(slot * FOUR_HOURS_MS);
    assert.ok(allowed.has(phoneKey(account.number)));
  }
});
