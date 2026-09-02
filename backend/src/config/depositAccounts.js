/**
 * Server-side deposit receiving accounts.
 * Receiver names/accounts are never trusted from the client.
 */

const TELEBIRR_PROVIDER = 'telebirr';
const CBE_PROVIDER = 'cbe';

function pick(...values) {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return '';
}

function digitsOnly(value) {
  return String(value ?? '').replace(/\D/g, '');
}

/** Last 9 national digits — 0979596741 and 251979596741 map to the same account. */
function phoneKey(value) {
  const digits = digitsOnly(value);
  if (digits.length >= 9) return digits.slice(-9);
  return digits;
}

/**
 * Parse DEPOSIT_TELEBIRR_ACCOUNTS=0979596741:WASIHUN,0926202638:tamirat
 * into phoneKey → { number, receiverName }.
 */
function parseTelebirrAccounts(raw = process.env.DEPOSIT_TELEBIRR_ACCOUNTS) {
  const map = new Map();
  const source = String(raw ?? '').trim();
  if (!source) return map;

  for (const part of source.split(',')) {
    const entry = part.trim();
    if (!entry) continue;
    const sep = entry.indexOf(':');
    if (sep < 1) continue;
    const number = digitsOnly(entry.slice(0, sep));
    const receiverName = entry.slice(sep + 1).trim();
    const key = phoneKey(number);
    if (!key || !receiverName) continue;
    map.set(key, {
      number,
      displayNumber: number.length === 9 ? `0${number}` : number,
      receiverName,
    });
  }
  return map;
}

function getTelebirrAccounts() {
  return parseTelebirrAccounts(process.env.DEPOSIT_TELEBIRR_ACCOUNTS);
}

function getTelebirrRotationMs() {
  const hours = Number(process.env.DEPOSIT_TELEBIRR_ROTATION_HOURS);
  if (Number.isFinite(hours) && hours > 0) {
    return hours * 60 * 60 * 1000;
  }
  return 4 * 60 * 60 * 1000;
}

/**
 * Bot-only: pick one Telebirr receiving number from DEPOSIT_TELEBIRR_ACCOUNTS.
 * The selected number changes automatically every ROTATION_HOURS (default 4).
 */
function getRotatedTelebirrAccount(at = Date.now()) {
  const accounts = [...getTelebirrAccounts().values()];
  if (accounts.length === 0) return null;
  const periodMs = getTelebirrRotationMs();
  const index = Math.floor(Number(at) / periodMs) % accounts.length;
  return accounts[index];
}

function findTelebirrAccount(selectedNumber) {
  const key = phoneKey(selectedNumber);
  if (!key) return null;
  return getTelebirrAccounts().get(key) || null;
}

function getCbeConfig() {
  const mapped = parseTelebirrAccounts(
    process.env.DEPOSIT_CBEBIRR_ACCOUNTS || process.env.DEPOSIT_CBE_ACCOUNTS || ''
  );
  const mappedAccount = [...mapped.values()][0] || null;
  const number = pick(
    process.env.DEPOSIT_CBEBIRR_NUMBER,
    process.env.DEPOSIT_CBE_NUMBER,
    process.env.DEPOSIT_CBE_BIRR_NUMBER,
    process.env.CBEBIRR_NUMBER,
    process.env.CBE_NUMBER,
    process.env.CBE_PHONE,
    mappedAccount?.displayNumber,
    mappedAccount?.number
  );
  const receiverName = pick(
    process.env.DEPOSIT_CBEBIRR_RECEIVER_NAME,
    process.env.DEPOSIT_CBE_RECEIVER_NAME,
    process.env.DEPOSIT_CBE_NAME,
    process.env.CBEBIRR_RECEIVER_NAME,
    process.env.CBE_RECEIVER_NAME,
    process.env.CBE_NAME,
    mappedAccount?.receiverName
  );
  const receiverAccount = pick(
    process.env.DEPOSIT_CBEBIRR_ACCOUNT,
    process.env.DEPOSIT_CBE_ACCOUNT,
    process.env.DEPOSIT_CBE_BIRR_ACCOUNT,
    process.env.CBEBIRR_ACCOUNT,
    process.env.CBE_ACCOUNT
  );
  return {
    number,
    receiverName,
    receiverAccount,
    configured: Boolean((number || receiverAccount) && receiverName),
  };
}

function normalizeProvider(value) {
  const key = String(value || '')
    .trim()
    .toLowerCase();
  if (key === TELEBIRR_PROVIDER || key === 'tele') return TELEBIRR_PROVIDER;
  if (key === CBE_PROVIDER || key === 'cbebirr' || key === 'cbe_birr' || key === 'cbe-birr') {
    return CBE_PROVIDER;
  }
  return '';
}

/**
 * Resolve qbirr receiver fields from server env only.
 * @returns {{ ok: true, provider, receiverName, receiverAccount, receivingNumber } | { ok: false, error }}
 */
function resolveReceiver(provider, selectedNumber) {
  const normalized = normalizeProvider(provider);
  if (!normalized) {
    return { ok: false, error: 'invalid_provider' };
  }

  if (normalized === TELEBIRR_PROVIDER) {
    const accounts = getTelebirrAccounts();
    if (accounts.size === 0) {
      return { ok: false, error: 'missing_receiver_configuration' };
    }
    const account = findTelebirrAccount(selectedNumber);
    if (!account) {
      return { ok: false, error: 'unknown_receiving_number' };
    }
    return {
      ok: true,
      provider: TELEBIRR_PROVIDER,
      receiverName: account.receiverName,
      receiverAccount: '',
      receivingNumber: account.displayNumber || account.number,
    };
  }

  const cbe = getCbeConfig();
  if (!cbe.configured) {
    return { ok: false, error: 'missing_receiver_configuration' };
  }
  return {
    ok: true,
    provider: CBE_PROVIDER,
    receiverName: cbe.receiverName,
    receiverAccount: cbe.receiverAccount || cbe.number,
    receivingNumber: cbe.number || cbe.receiverAccount,
  };
}

/** Public Mini App / bot listing — no secrets. */
function getPublicDepositMethods() {
  const telebirr = [...getTelebirrAccounts().values()].map((account) => ({
    number: account.displayNumber || account.number,
    receiverName: account.receiverName,
  }));
  const cbe = getCbeConfig();

  return {
    telebirr: {
      provider: TELEBIRR_PROVIDER,
      label: 'Telebirr',
      enabled: telebirr.length > 0,
      accounts: telebirr,
    },
    cbe: {
      provider: CBE_PROVIDER,
      label: 'CBEBirr',
      enabled: cbe.configured,
      number: cbe.number,
      receiverName: cbe.receiverName,
      account: cbe.receiverAccount,
    },
  };
}

/** Production startup check — never logs secrets. */
function logDepositStartupStatus() {
  const methods = getPublicDepositMethods();
  const qbirrKeyConfigured = Boolean(String(process.env.QBIRR_API_KEY || '').trim());
  const qbirrBaseUrl = String(
    process.env.QBIRR_BASE_URL || 'https://verify.qbirr.com'
  ).trim();
  const telebirrAccounts = methods.telebirr.accounts.length;
  const cbeConfigured = methods.cbe.enabled;

  console.log('[deposit] startup', {
    qbirrKeyConfigured,
    qbirrBaseUrl,
    telebirrAccounts,
    cbeConfigured,
  });

  if (!qbirrKeyConfigured) {
    console.error(
      '[deposit] QBIRR_API_KEY is not set. Receipt verification will return "Deposits are temporarily unavailable." Set QBIRR_API_KEY in Railway Variables (local backend/.env is not uploaded).'
    );
  }
  if (telebirrAccounts === 0) {
    console.error(
      '[deposit] DEPOSIT_TELEBIRR_ACCOUNTS is not set. Telebirr deposits cannot start. Set it in Railway Variables.'
    );
  }
  if (!cbeConfigured) {
    console.warn(
      '[deposit] CBE Birr is not configured. Set DEPOSIT_CBEBIRR_RECEIVER_NAME and DEPOSIT_CBEBIRR_ACCOUNT (DEPOSIT_CBEBIRR_NUMBER is optional).'
    );
  }
}

function getEnabledPaymentMethods() {
  const methods = getPublicDepositMethods();
  const list = [];
  if (methods.telebirr.enabled) {
    list.push({
      name: TELEBIRR_PROVIDER,
      enabled: true,
      label: 'Telebirr',
      accounts: methods.telebirr.accounts,
    });
  }
  if (methods.cbe.enabled) {
    list.push({
      name: CBE_PROVIDER,
      enabled: true,
      label: 'CBE Birr',
      phoneNumber: methods.cbe.number,
      accountName: methods.cbe.receiverName,
      accountNumber: methods.cbe.account,
    });
  }
  return list;
}

module.exports = {
  TELEBIRR_PROVIDER,
  CBE_PROVIDER,
  digitsOnly,
  phoneKey,
  parseTelebirrAccounts,
  getTelebirrAccounts,
  getTelebirrRotationMs,
  getRotatedTelebirrAccount,
  findTelebirrAccount,
  getCbeConfig,
  normalizeProvider,
  resolveReceiver,
  getPublicDepositMethods,
  getEnabledPaymentMethods,
  logDepositStartupStatus,
};
