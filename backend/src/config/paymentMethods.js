const { loadEnv } = require('./env');
const {
  getEnabledPaymentMethods,
  getPublicDepositMethods,
  normalizeProvider,
} = require('./depositAccounts');

function buildPaymentMethods() {
  loadEnv();
  return getEnabledPaymentMethods();
}

let cachedMethods = null;

function getPaymentMethods() {
  if (!cachedMethods) {
    cachedMethods = buildPaymentMethods();
    const methods = getPublicDepositMethods();
    console.log('[deposit] methods', {
      telebirrAccounts: methods.telebirr.accounts.length,
      cbeConfigured: methods.cbe.enabled,
    });
  }
  return cachedMethods;
}

function getPaymentMethod(methodKey) {
  const key = normalizeProvider(methodKey) || String(methodKey || '').toLowerCase();
  const methods = getPaymentMethods();
  return (
    methods.find((m) => m.name === key) ||
    methods.find((m) => m.name === 'telebirr') ||
    methods[0] ||
    null
  );
}

module.exports = {
  buildPaymentMethods,
  getPaymentMethods,
  getEnabledPaymentMethods,
  getPaymentMethod,
};
