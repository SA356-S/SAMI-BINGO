process.env.BOT_TOKEN = '123456:ABC-DEF';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  resolveTelegramUserId,
  attachTelegramUserFromRequest,
} = require('../src/utils/telegramAuth');
const { resolveUserId } = require('../src/socket/walletManager');

function makeInitData(userId) {
  const user = JSON.stringify({ id: userId, first_name: 'A' });
  const p = new URLSearchParams({ query_id: 'AA', user, auth_date: '1700000000' });
  const pairs = [...p.entries()].map(([k, v]) => `${k}=${v}`).sort();
  const sk = crypto.createHmac('sha256', 'WebAppData').update(process.env.BOT_TOKEN).digest();
  p.set('hash', crypto.createHmac('sha256', sk).update(pairs.join('\n')).digest('hex'));
  return p.toString();
}

const victim = '87237262';
const attacker = '111111111';
const attackerInit = makeInitData(attacker);
const tamperedInit = attackerInit.replace(String(attacker), String(victim));

const socketSrc = fs.readFileSync(path.join(__dirname, '../src/socket.js'), 'utf8');

const results = {
  wallet_deposit_handler_removed: !socketSrc.includes('wallet:deposit'),
  wallet_withdraw_handler_removed: !socketSrc.includes('wallet:withdraw'),
  initData_spoof_explicit_userId: resolveTelegramUserId({ auth: { userId: victim } }),
  initData_tampered_user_field: resolveTelegramUserId({ auth: { initData: tamperedInit } }),
  initData_valid_attacker: resolveTelegramUserId({ auth: { initData: attackerInit } }),
};

const reqQueryOnly = { query: { userId: victim }, headers: {}, body: {} };
attachTelegramUserFromRequest(reqQueryOnly, {}, () => {});
results.wallet_api_query_only_userId = reqQueryOnly.telegramUserId ?? null;

const reqBadInit = {
  query: { userId: victim },
  headers: { 'x-telegram-init-data': 'user=%7B%22id%22%3A1%7D&hash=deadbeef' },
  body: {},
};
attachTelegramUserFromRequest(reqBadInit, {}, () => {});
results.wallet_api_bad_initData = reqBadInit.telegramUserId ?? null;

const reqCross = {
  query: { userId: victim },
  headers: { 'x-telegram-init-data': attackerInit },
  body: {},
};
attachTelegramUserFromRequest(reqCross, {}, () => {});
results.wallet_api_attacker_init_victim_query = reqCross.telegramUserId ?? null;

const verifiedSocket = {
  handshake: { auth: { initData: attackerInit } },
  data: {},
  id: 'sock1',
};
const spoofSocket = { handshake: { auth: { userId: victim } }, data: {}, id: 'sock2' };
const noAuthSocket = { handshake: { auth: {} }, data: {}, id: 'sock3' };

results.game_join_verified_init = resolveUserId(verifiedSocket, { userId: victim });
results.game_join_spoof_payload_only = resolveUserId(spoofSocket, { userId: victim });
results.game_join_no_auth = resolveUserId(noAuthSocket, { userId: victim });

console.log(JSON.stringify(results, null, 2));
