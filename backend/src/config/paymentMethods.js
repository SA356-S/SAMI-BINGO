const { loadEnv } = require('./env');

function envFlag(value, defaultValue = true) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  const normalized = String(value).trim().toLowerCase();
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  return true;
}

function pick(...values) {
  for (const v of values) {
    const s = String(v ?? '').trim();
    if (s) return s;
  }
  return '';
}

function buildPaymentMethods() {
  loadEnv();

  const telebirrName = pick(
    process.env.TELEBIRR_NAME,
    process.env.BOT_DEPOSIT_TELEBIRR_NAME
  );
  const telebirrPhone = pick(
    process.env.TELEBIRR_PHONE,
    process.env.BOT_DEPOSIT_TELEBIRR_ACCOUNT,
    process.env.TELEBIRR_ACCOUNT
  );
  const telebirrEnabled = envFlag(process.env.ENABLE_TELEBIRR, true);

  const cbeName = pick(process.env.CBE_NAME, process.env.BOT_DEPOSIT_CBE_NAME);
  const cbePhone = pick(
    process.env.CBE_PHONE,
    process.env.BOT_DEPOSIT_CBE_ACCOUNT,
    process.env.CBE_ACCOUNT
  );
  const cbeEnabled = envFlag(
    process.env.ENABLE_CBE,
    Boolean(cbeName || cbePhone)
  );

  const methods = [];

  if (telebirrEnabled) {
    methods.push({
      name: 'telebirr',
      enabled: true,
      accountName: telebirrName || 'Telebirr',
      phoneNumber: telebirrPhone,
      label: 'Telebirr',
    });
  }

  if (cbeEnabled && (cbeName || cbePhone)) {
    methods.push({
      name: 'cbe',
      enabled: true,
      accountName: cbeName,
      phoneNumber: cbePhone,
      label: 'CBE',
    });
  }

  // Fail-safe: never return an empty list — Telebirr from env is always available.
  if (methods.length === 0) {
    methods.push({
      name: 'telebirr',
      enabled: true,
      accountName: telebirrName || 'Telebirr',
      phoneNumber: telebirrPhone,
      label: 'Telebirr',
    });
  }

  return methods;
}

let cachedMethods = null;

function getPaymentMethods() {
  if (!cachedMethods) {
    cachedMethods = buildPaymentMethods();
    console.log('[deposit] paymentMethods', cachedMethods);
    console.log('[deposit] TELEBIRR_NAME', process.env.TELEBIRR_NAME);
    console.log('[deposit] TELEBIRR_PHONE', process.env.TELEBIRR_PHONE);
  }
  return cachedMethods;
}

function getEnabledPaymentMethods() {
  return getPaymentMethods().filter((m) => m.enabled);
}

function getPaymentMethod(methodKey) {
  const key = String(methodKey || '').toLowerCase();
  const methods = getPaymentMethods();

  const found = methods.find(
    (m) => m.name === key || key.includes(m.name) || m.name.includes(key)
  );
  if (found) return found;

  // Default fallback: Telebirr
  return (
    methods.find((m) => m.name === 'telebirr') ||
    methods[0] || {
      name: 'telebirr',
      enabled: true,
      accountName: pick(process.env.TELEBIRR_NAME) || 'Telebirr',
      phoneNumber: pick(process.env.TELEBIRR_PHONE),
      label: 'Telebirr',
    }
  );
}

function getReceiverConfigForVerification(paymentMethod) {
  const method = getPaymentMethod(paymentMethod);
  return {
    receiverAccount: method.phoneNumber,
    receiverName: method.accountName,
  };
}

module.exports = {
  buildPaymentMethods,
  getPaymentMethods,
  getEnabledPaymentMethods,
  getPaymentMethod,
  getReceiverConfigForVerification,
};
