const robotConfigService = require('./robotConfigService');

async function getBalance() {
  const cfg = await robotConfigService.getConfig();
  return Number(cfg.bankBalance) || 0;
}

function getBalanceSync() {
  const cfg = robotConfigService.getConfigSync();
  return Number(cfg.bankBalance) || 0;
}

async function topup(amount) {
  const res = await robotConfigService.topupBank(amount);
  return res;
}

function topupSync(amount) {
  return robotConfigService.topupBankSync(amount);
}

async function deduct(amount) {
  return robotConfigService.deductBank(amount);
}

function deductSync(amount) {
  return robotConfigService.deductBankSync(amount);
}

module.exports = {
  getBalance,
  getBalanceSync,
  topup,
  topupSync,
  deduct,
  deductSync,
};

