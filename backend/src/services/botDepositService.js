const { DepositModel } = require('../models/Deposit');
const { mongoose } = require('../config/db');
const { creditDepositAsync } = require('../socket/walletManager');
const { recordTransaction } = require('./walletTransactionService');
const { parseDepositMessage, parseBirrAmount } = require('./depositMessageParser');
const { verifyTelebirr, verifyCbeBirr, isVerifierEnabled } = require('./verifierApiClient');
const { getPaymentMethod } = require('../config/paymentMethods');

const PENDING_LOCK_MS = 2 * 60 * 1000;

const PERMANENT_REJECTION_REASONS = new Set([
  'payment_status_failed',
  'telebirr_verification_failed',
  'cbebirr_verification_failed',
  'cbebirr_params_required',
  'receipt_amount_missing',
  'wallet_credit_failed',
  'receiver_mismatch',
  'duplicate_transaction_global',
]);

const globallyProcessedTelebirrTxIds = new Set();
const telebirrTxEvictionQueue = [];
const MAX_TELEBIRR_TX_CACHE = Math.max(
  5000,
  Number(process.env.TELEBIRR_TX_CACHE_MAX) || 50000
);
let telebirrMemoryCacheWarmed = false;
let legacyMongoConnection = null;
let legacyMongoUnavailable = false;

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeString(v) {
  return String(v ?? '').trim();
}

function normalizeTxId(v) {
  return normalizeString(v).toUpperCase().replace(/\s+/g, '');
}

function normalizeReceiverName(name) {
  return normalizeString(name).toLowerCase().replace(/\s+/g, ' ');
}

function buildEthiopianPhoneVariants(phone) {
  const digits = normalizeString(phone).replace(/\D/g, '');
  const variants = new Set();
  if (!digits) return variants;

  variants.add(digits);

  if (digits.startsWith('0') && digits.length === 10) {
    variants.add(`251${digits.slice(1)}`);
    variants.add(digits.slice(1));
  }
  if (digits.startsWith('251') && digits.length >= 12) {
    variants.add(digits.slice(3));
    variants.add(`0${digits.slice(3)}`);
  }
  if (digits.length === 9 && digits.startsWith('9')) {
    variants.add(`251${digits}`);
    variants.add(`0${digits}`);
  }

  return variants;
}

function telebirrReceiverNameMatches(actualName, expectedName) {
  const actual = normalizeReceiverName(actualName);
  const expected = normalizeReceiverName(expectedName);
  if (!expected) return false;
  if (!actual) return false;
  return actual === expected;
}

function telebirrReceiverAccountMatches(actualAccount, expectedPhone) {
  const expectedVariants = buildEthiopianPhoneVariants(expectedPhone);
  if (!expectedVariants.size) return false;

  const raw = normalizeString(actualAccount);
  if (!raw) return false;

  const actualDigits = raw.replace(/\D/g, '');

  for (const exp of expectedVariants) {
    if (actualDigits && actualDigits === exp) return true;
    if (
      actualDigits.length >= 9 &&
      exp.length >= 9 &&
      actualDigits.slice(-9) === exp.slice(-9)
    ) {
      return true;
    }
  }

  if (raw.includes('*')) {
    const prefixMatch = raw.match(/^(\d+)\*+/);
    const suffixMatch = raw.match(/\*+(\d+)$/);
    if (prefixMatch && suffixMatch) {
      const prefix = prefixMatch[1];
      const suffix = suffixMatch[1];
      for (const exp of expectedVariants) {
        const norm = exp.startsWith('251')
          ? exp
          : exp.startsWith('0')
            ? `251${exp.slice(1)}`
            : `251${exp}`;
        if (
          norm.length >= prefix.length + suffix.length &&
          norm.startsWith(prefix) &&
          norm.endsWith(suffix)
        ) {
          return true;
        }
      }
    }
  }

  return false;
}

function validateConfiguredTelebirrReceiver(verified) {
  const method = getPaymentMethod('telebirr');
  const expectedName = method?.accountName || '';
  const expectedPhone = method?.phoneNumber || '';
  const actualName = verified?.receiverName || '';
  const actualAccount = verified?.receiverAccount || '';

  const expected = {
    receiverName: expectedName,
    receiverAccount: expectedPhone,
  };
  const actual = {
    receiverName: actualName,
    receiverAccount: actualAccount,
  };

  const nameOk = telebirrReceiverNameMatches(actualName, expectedName);
  const accountOk = telebirrReceiverAccountMatches(actualAccount, expectedPhone);

  if (nameOk && accountOk) {
    return { ok: true };
  }

  return {
    ok: false,
    error: 'receiver_mismatch',
    expected,
    actual,
    nameOk,
    accountOk,
  };
}

function collectTxIds(parsed) {
  const ids = new Set();
  if (parsed?.transactionId) ids.add(normalizeTxId(parsed.transactionId));
  if (parsed?.apiReference) ids.add(normalizeTxId(parsed.apiReference));
  if (parsed?.transactionNumber) ids.add(normalizeTxId(parsed.transactionNumber));
  return [...ids].filter(Boolean);
}

function collectGlobalTelebirrDedupKeys(parsed, verified, raw) {
  const keys = new Set(collectTxIds(parsed));
  if (verified?.transactionId) keys.add(normalizeTxId(verified.transactionId));
  if (raw?.receiptNo) keys.add(normalizeTxId(raw.receiptNo));
  return [...keys].filter(Boolean);
}

function markGloballyProcessedTelebirrTx(txKeys) {
  for (const key of txKeys || []) {
    const normalized = normalizeTxId(key);
    if (!normalized || globallyProcessedTelebirrTxIds.has(normalized)) continue;
    globallyProcessedTelebirrTxIds.add(normalized);
    telebirrTxEvictionQueue.push(normalized);
    while (telebirrTxEvictionQueue.length > MAX_TELEBIRR_TX_CACHE) {
      const evicted = telebirrTxEvictionQueue.shift();
      if (evicted) globallyProcessedTelebirrTxIds.delete(evicted);
    }
  }
}

function findInMemoryGloballyProcessedTx(txKeys) {
  for (const key of txKeys || []) {
    const normalized = normalizeTxId(key);
    if (normalized && globallyProcessedTelebirrTxIds.has(normalized)) {
      return normalized;
    }
  }
  return null;
}

async function warmTelebirrProcessedCacheFromCurrentDb() {
  if (telebirrMemoryCacheWarmed) return;
  telebirrMemoryCacheWarmed = true;

  try {
    const approved = await DepositModel.find({
      status: 'approved',
      paymentMethod: 'telebirr',
    })
      .select('transactionId')
      .lean();

    for (const doc of approved) {
      if (doc?.transactionId) {
        globallyProcessedTelebirrTxIds.add(normalizeTxId(doc.transactionId));
      }
    }
  } catch (err) {
    console.warn('[botDeposit] failed to warm Telebirr processed cache', err?.message || err);
  }
}

function getLegacyMongoUri() {
  return String(
    process.env.LEGACY_MONGO_URI ||
      process.env.MONGO_URI_LEGACY ||
      process.env.OLD_MONGO_URI ||
      ''
  ).trim();
}

async function getLegacyMongoConnection() {
  if (legacyMongoUnavailable) return null;

  const uri = getLegacyMongoUri();
  if (!uri) return null;

  if (legacyMongoConnection?.readyState === 1) {
    return legacyMongoConnection;
  }

  try {
    legacyMongoConnection = await mongoose
      .createConnection(uri, {
        serverSelectionTimeoutMS:
          Number(process.env.LEGACY_MONGO_SERVER_SELECTION_TIMEOUT_MS) || 8000,
        connectTimeoutMS: Number(process.env.LEGACY_MONGO_CONNECT_TIMEOUT_MS) || 8000,
      })
      .asPromise();
    return legacyMongoConnection;
  } catch (err) {
    legacyMongoUnavailable = true;
    console.warn('[botDeposit] legacy MongoDB unavailable for replay protection', {
      message: err?.message || String(err),
    });
    return null;
  }
}

async function findLegacyApprovedTelebirrDeposit(txKeys) {
  if (!txKeys.length) return null;

  const connection = await getLegacyMongoConnection();
  if (!connection) return null;

  try {
    return await connection.db.collection('deposits').findOne({
      transactionId: { $in: txKeys },
      status: 'approved',
      paymentMethod: 'telebirr',
    });
  } catch (err) {
    console.warn('[botDeposit] legacy deposit lookup failed', err?.message || err);
    return null;
  }
}

async function findCurrentApprovedTelebirrDeposit(txKeys) {
  if (!txKeys.length) return null;

  return DepositModel.findOne({
    transactionId: { $in: txKeys },
    status: 'approved',
    paymentMethod: 'telebirr',
  }).lean();
}

async function assertTelebirrNotGloballyDuplicate({ globalKeys }) {
  if (!globalKeys.length) {
    return { ok: true };
  }

  await warmTelebirrProcessedCacheFromCurrentDb();

  const memoryHit = findInMemoryGloballyProcessedTx(globalKeys);
  if (memoryHit) {
    return {
      ok: false,
      error: 'duplicate_transaction_global',
      source: 'memory_cache',
      matchedTransactionId: memoryHit,
    };
  }

  const currentApproved = await findCurrentApprovedTelebirrDeposit(globalKeys);
  if (currentApproved) {
    markGloballyProcessedTelebirrTx([currentApproved.transactionId, ...globalKeys]);
    return {
      ok: false,
      error: 'duplicate_transaction_global',
      source: 'current_database',
      matchedTransactionId: currentApproved.transactionId,
      depositId: String(currentApproved._id),
    };
  }

  const legacyApproved = await findLegacyApprovedTelebirrDeposit(globalKeys);
  if (legacyApproved) {
    markGloballyProcessedTelebirrTx([legacyApproved.transactionId, ...globalKeys]);
    return {
      ok: false,
      error: 'duplicate_transaction_global',
      source: 'legacy_database',
      matchedTransactionId: legacyApproved.transactionId,
      depositId: legacyApproved._id ? String(legacyApproved._id) : undefined,
    };
  }

  return { ok: true };
}

function isSuccessStatus(status) {
  const s = normalizeString(status).toLowerCase();
  if (!s) return false;
  return /\b(success|successful|completed|complete|paid|settled|approved)\b/i.test(s);
}

function isTransientVerificationError(errorCode) {
  const code = normalizeString(errorCode).toLowerCase();
  if (
    [
      'verifier_timeout',
      'verifier_disabled',
      'verifier_unreachable',
      'fetch failed',
      'verification_failed',
      'verification_exception',
    ].includes(code)
  ) {
    return true;
  }
  return /fetch failed|network|timeout|econnrefused|enotfound|eai_again|aborterror|socket hang up/i.test(
    code
  );
}

function isPermanentRejection(reason) {
  const r = normalizeString(reason).toLowerCase();
  if (!r) return false;
  if (isTransientVerificationError(r)) return false;
  // Legacy mismatch rejections — allow retry.
  if (r === 'amount_mismatch') return false;
  return PERMANENT_REJECTION_REASONS.has(r);
}

async function clearTransientRejectedDeposits(txIds) {
  if (!txIds.length) return;
  await DepositModel.deleteMany({
    transactionId: { $in: txIds },
    status: 'rejected',
    rejectionReason: {
      $in: [
        'verifier_timeout',
        'verifier_disabled',
        'verifier_unreachable',
        'fetch failed',
        'verification_failed',
        'verification_exception',
        'amount_mismatch',
      ],
    },
  });
  await DepositModel.deleteMany({
    transactionId: { $in: txIds },
    status: 'rejected',
    rejectionReason: { $regex: /fetch failed|timeout|unreachable|network|amount_mismatch|mismatch/i },
  });
}

/**
 * Returns a deposit that should block retry, or null if retry is allowed.
 */
async function findBlockingDeposit(txIds) {
  if (!txIds.length) return null;

  const docs = await DepositModel.find({ transactionId: { $in: txIds } })
    .sort({ updatedAt: -1 })
    .lean();

  for (const doc of docs) {
    if (doc.status === 'approved') return doc;

    if (doc.status === 'pending') {
      const ageMs =
        Date.now() - new Date(doc.updatedAt || doc.createdAt || 0).getTime();
      if (ageMs < PENDING_LOCK_MS) return doc;
      continue;
    }

    if (doc.status === 'rejected' && isPermanentRejection(doc.rejectionReason)) {
      return doc;
    }
  }

  return null;
}

async function recordRejectedDeposit(payload) {
  const {
    userId,
    txId,
    submittedAmount,
    paymentMethod,
    receiptLink,
    rawProofText,
    rejectionReason,
    verified = null,
  } = payload;

  if (isTransientVerificationError(rejectionReason)) {
    return { duplicate: false, skipped: true };
  }

  const normalizedTxId = normalizeTxId(txId);
  if (!normalizedTxId) {
    return { duplicate: false, skipped: true };
  }

  try {
    await DepositModel.findOneAndUpdate(
      { transactionId: normalizedTxId, status: { $ne: 'approved' } },
      {
        $set: {
          userId,
          transactionId: normalizedTxId,
          submittedAmount: submittedAmount ?? 0,
          verifiedAmount: verified?.verifiedAmount ?? null,
          amount: verified?.verifiedAmount ?? 0,
          paymentMethod,
          status: 'rejected',
          receiptLink: receiptLink || '',
          officialPaymentLink: receiptLink || '',
          senderName: verified?.senderName || '',
          receiverName: verified?.receiverName || '',
          receiverAccount: verified?.receiverAccount || '',
          paymentStatus: verified?.paymentStatus || '',
          transactionDate: verified?.transactionDate || '',
          proofText: normalizeString(rawProofText),
          rejectionReason,
          verifiedAt: new Date(),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  } catch (err) {
    if (String(err?.code) === '11000') {
      const existing = await DepositModel.findOne({ transactionId: normalizedTxId }).lean();
      if (existing?.status === 'approved') return { duplicate: true };
    }
    console.error('[botDeposit] failed to record rejected deposit', err?.message || err);
  }
  return { duplicate: false, skipped: false };
}

function logFailedAttempt(payload) {
  console.warn('[botDeposit] verification failed', payload);
}

function mapTelebirrVerifierResult(data, parsed) {
  const verifiedAmount = parseBirrAmount(data?.settledAmount);
  const transactionId = normalizeTxId(data?.receiptNo || parsed.transactionId);
  const paymentStatus = normalizeString(data?.transactionStatus);

  return {
    transactionId,
    verifiedAmount,
    paymentStatus,
    senderName: data?.payerName || '',
    receiverName: data?.creditedPartyName || '',
    receiverAccount: data?.creditedPartyAccountNo || '',
    transactionDate: data?.paymentDate || '',
    success: isSuccessStatus(paymentStatus),
  };
}

function mapCbeBirrVerifierResult(data, parsed) {
  const verifiedAmount =
    parseBirrAmount(data?.amount) ||
    parseBirrAmount(data?.transactionAmount) ||
    parseBirrAmount(data?.settledAmount);
  const transactionId = normalizeTxId(
    data?.receiptNumber || data?.transactionId || parsed.transactionId
  );
  const paymentStatus = normalizeString(data?.status || data?.transactionStatus);

  return {
    transactionId,
    verifiedAmount,
    paymentStatus,
    senderName: data?.payerName || data?.senderName || '',
    receiverName: data?.receiverName || '',
    receiverAccount: data?.receiverPhone || parsed.phoneNumber || '',
    transactionDate: data?.transactionDate || data?.paymentDate || '',
    success: data?.success !== false && (paymentStatus ? isSuccessStatus(paymentStatus) : true),
  };
}

async function verifyViaExternalApi(parsed) {
  if (!isVerifierEnabled()) {
    return { ok: false, error: 'verifier_disabled' };
  }

  if (parsed.paymentMethod === 'cbebirr') {
    const phone =
      parsed.phoneNumber ||
      getPaymentMethod('cbe').phoneNumber ||
      process.env.CBE_BIRR_PHONE ||
      process.env.CBE_PHONE;

    const phone251 = String(phone).replace(/\D/g, '');
    const normalizedPhone = phone251.startsWith('251')
      ? phone251
      : phone251.startsWith('09')
        ? `251${phone251.slice(1)}`
        : `251${phone251}`;

    const result = await verifyCbeBirr(parsed.apiReference, normalizedPhone);
    if (!result.ok) {
      return { ok: false, error: result.error || 'cbebirr_verification_failed', raw: result.raw };
    }
    const mapped = mapCbeBirrVerifierResult(result.data, parsed);
    return { ok: true, verified: mapped, raw: result.data };
  }

  const result = await verifyTelebirr(parsed.apiReference);
  if (!result.ok) {
    return { ok: false, error: result.error || 'telebirr_verification_failed', raw: result.raw };
  }
  const mapped = mapTelebirrVerifierResult(result.data, parsed);
  return { ok: true, verified: mapped, raw: result.data };
}

/**
 * Credited amount comes from the verifier API only — never from user-submitted SMS text
 * or bot-entered reference amounts.
 */
function resolveTrustedDepositAmount(verified, parsed) {
  const fromApi = toNumber(verified?.verifiedAmount);
  if (fromApi != null && fromApi > 0) {
    const fromMessage = toNumber(parsed?.amount);
    if (fromMessage != null && fromMessage > 0 && Math.abs(fromMessage - fromApi) > 0.5) {
      console.warn('[botDeposit] SMS message amount ignored; crediting verifier API amount only', {
        messageAmount: fromMessage,
        verifiedAmount: fromApi,
      });
    }
    return { ok: true, verifiedAmount: fromApi, source: 'api' };
  }

  return { ok: false, error: 'receipt_amount_missing' };
}

function logBotAmountIgnored(botReferenceAmount, trustedAmount, source) {
  const bot = toNumber(botReferenceAmount);
  const trusted = toNumber(trustedAmount);
  if (bot == null || trusted == null || bot <= 0) return;
  const diff = Math.abs(bot - trusted);
  if (diff > 0.5) {
    console.info('[botDeposit] bot-entered amount ignored; using trusted source', {
      botEnteredAmount: bot,
      trustedAmount: trusted,
      source,
    });
  }
}

async function createPendingDeposit(payload) {
  const { txId, userId, botReferenceAmount, parsed, rawMessage, verified, creditAmount } =
    payload;
  const normalizedTxId = normalizeTxId(txId);

  const deposit = await DepositModel.findOneAndUpdate(
    {
      transactionId: normalizedTxId,
      status: { $nin: ['approved', 'pending'] },
    },
    {
      $set: {
        userId,
        transactionId: normalizedTxId,
        submittedAmount: botReferenceAmount ?? 0,
        verifiedAmount: creditAmount,
        amount: creditAmount,
        paymentMethod: parsed.paymentMethod,
        status: 'pending',
        receiptLink: parsed.receiptLink || '',
        officialPaymentLink: parsed.receiptLink || '',
        senderName: verified?.senderName || '',
        receiverName: verified?.receiverName || '',
        receiverAccount: verified?.receiverAccount || '',
        paymentStatus: verified?.paymentStatus || '',
        transactionDate: verified?.transactionDate || '',
        proofText: rawMessage,
        rejectionReason: '',
        verifiedAt: null,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return deposit;
}

/**
 * Verify deposit via verifier-api and credit play_wallet only.
 * @param {object} params
 * @param {string} params.userId
 * @param {string} params.rawProofText - payment SMS / transaction message
 * @param {string|null} [params.paymentMethod]
 * @param {number|null} [params.submittedAmount] - bot UI amount (reference/logging only)
 */
async function verifyAndApproveDeposit({
  userId,
  rawProofText,
  paymentMethod: explicitMethod = null,
  submittedAmount = null,
}) {
  const uid = normalizeString(userId);
  const rawMessage = normalizeString(rawProofText);
  /** Reference only — never used for validation or wallet credit. */
  const botReferenceAmount = toNumber(submittedAmount);

  if (!uid) return { ok: false, error: 'userId_required' };
  if (!rawMessage) return { ok: false, error: 'message_required' };

  const parsed = parseDepositMessage(rawMessage);
  if (!parsed.ok) {
    logFailedAttempt({ userId: uid, reason: parsed.error, preview: rawMessage.slice(0, 200) });
    return { ok: false, error: parsed.error || 'message_parse_failed' };
  }

  if (explicitMethod) {
    parsed.paymentMethod = normalizeString(explicitMethod).toLowerCase().includes('cbe')
      ? 'cbebirr'
      : 'telebirr';
  }

  const txIds = collectTxIds(parsed);

  await clearTransientRejectedDeposits(txIds);

  const blocking = await findBlockingDeposit(txIds);
  if (blocking) {
    if (blocking.status === 'pending') {
      return { ok: false, error: 'transaction_in_progress' };
    }
    return { ok: false, error: 'transaction_already_processed' };
  }

  let verification;
  try {
    verification = await verifyViaExternalApi(parsed);
  } catch (err) {
    logFailedAttempt({
      userId: uid,
      transactionIds: txIds,
      reason: 'verification_exception',
      message: err?.message,
    });
    return { ok: false, error: 'verification_failed' };
  }

  if (!verification?.ok) {
    logFailedAttempt({ userId: uid, transactionIds: txIds, reason: verification.error });
    if (isTransientVerificationError(verification.error)) {
      return { ok: false, error: verification.error || 'verification_failed' };
    }
    await recordRejectedDeposit({
      userId: uid,
      txId: txIds[0],
      submittedAmount: botReferenceAmount,
      paymentMethod: parsed.paymentMethod,
      receiptLink: parsed.receiptLink || '',
      rawProofText: rawMessage,
      rejectionReason: verification.error || 'rejected',
    });
    return { ok: false, error: verification.error || 'rejected' };
  }

  const verified = verification.verified;
  if (!verified.success) {
    await recordRejectedDeposit({
      userId: uid,
      txId: txIds[0],
      submittedAmount: botReferenceAmount,
      paymentMethod: parsed.paymentMethod,
      receiptLink: parsed.receiptLink || '',
      rawProofText: rawMessage,
      rejectionReason: 'payment_status_failed',
      verified,
    });
    return { ok: false, error: 'payment_status_failed' };
  }

  if (parsed.paymentMethod === 'telebirr') {
    const globalKeys = collectGlobalTelebirrDedupKeys(parsed, verified, verification.raw);
    const duplicateCheck = await assertTelebirrNotGloballyDuplicate({
      globalKeys,
    });
    if (!duplicateCheck.ok) {
      console.warn('[botDeposit] duplicate_transaction_global — Telebirr replay blocked', {
        userId: uid,
        transactionIds: globalKeys,
        source: duplicateCheck.source,
        matchedTransactionId: duplicateCheck.matchedTransactionId,
        depositId: duplicateCheck.depositId,
        replayFromOldSystem: duplicateCheck.source === 'legacy_database',
      });
      logFailedAttempt({
        userId: uid,
        transactionIds: globalKeys,
        reason: 'duplicate_transaction_global',
        source: duplicateCheck.source,
        matchedTransactionId: duplicateCheck.matchedTransactionId,
      });
      await recordRejectedDeposit({
        userId: uid,
        txId: globalKeys[0] || txIds[0],
        submittedAmount: botReferenceAmount,
        paymentMethod: parsed.paymentMethod,
        receiptLink: parsed.receiptLink || '',
        rawProofText: rawMessage,
        rejectionReason: 'duplicate_transaction_global',
        verified,
      });
      return { ok: false, error: 'duplicate_transaction_global' };
    }
  }

  const amountCheck = resolveTrustedDepositAmount(verified, parsed);
  if (!amountCheck.ok) {
    await recordRejectedDeposit({
      userId: uid,
      txId: txIds[0],
      submittedAmount: botReferenceAmount,
      paymentMethod: parsed.paymentMethod,
      receiptLink: parsed.receiptLink || '',
      rawProofText: rawMessage,
      rejectionReason: amountCheck.error,
      verified,
    });
    return { ok: false, error: amountCheck.error };
  }

  if (parsed.paymentMethod === 'telebirr') {
    const receiverCheck = validateConfiguredTelebirrReceiver(verified);
    if (!receiverCheck.ok) {
      console.warn('[botDeposit] receiver_mismatch — deposit blocked', {
        userId: uid,
        transactionIds: txIds,
        expected: receiverCheck.expected,
        actual: receiverCheck.actual,
        nameOk: receiverCheck.nameOk,
        accountOk: receiverCheck.accountOk,
      });
      logFailedAttempt({
        userId: uid,
        transactionIds: txIds,
        reason: 'receiver_mismatch',
        expected: receiverCheck.expected,
        actual: receiverCheck.actual,
      });
      await recordRejectedDeposit({
        userId: uid,
        txId: txIds[0],
        submittedAmount: botReferenceAmount,
        paymentMethod: parsed.paymentMethod,
        receiptLink: parsed.receiptLink || '',
        rawProofText: rawMessage,
        rejectionReason: 'receiver_mismatch',
        verified,
      });
      return { ok: false, error: 'receiver_mismatch' };
    }
  }

  const creditAmount = amountCheck.verifiedAmount;
  verified.verifiedAmount = creditAmount;
  logBotAmountIgnored(botReferenceAmount, creditAmount, amountCheck.source);
  const storeTxId = normalizeTxId(
    verified.transactionId || parsed.apiReference || parsed.transactionId
  );

  await DepositModel.deleteMany({
    transactionId: storeTxId,
    status: 'pending',
    updatedAt: { $lt: new Date(Date.now() - PENDING_LOCK_MS) },
  });

  let deposit;
  try {
    deposit = await createPendingDeposit({
      txId: storeTxId,
      userId: uid,
      botReferenceAmount,
      parsed,
      rawMessage,
      verified,
      creditAmount,
    });
  } catch (err) {
    if (String(err?.code) === '11000') {
      const existing = await DepositModel.findOne({ transactionId: storeTxId }).lean();
      if (existing?.status === 'approved') {
        return { ok: false, error: 'transaction_already_processed' };
      }
      if (existing?.status === 'pending') {
        return { ok: false, error: 'transaction_in_progress' };
      }
    }
    throw err;
  }

  if (!deposit) {
    const existing = await DepositModel.findOne({ transactionId: storeTxId }).lean();
    if (existing?.status === 'approved') {
      return { ok: false, error: 'transaction_already_processed' };
    }
    if (existing?.status === 'pending') {
      return { ok: false, error: 'transaction_in_progress' };
    }
    return { ok: false, error: 'verification_failed' };
  }

  const credit = await creditDepositAsync(uid, creditAmount, {
    depositId: String(deposit._id),
    transactionId: storeTxId,
    paymentMethod: parsed.paymentMethod,
    submittedAmount: botReferenceAmount ?? 0,
    verifiedAmount: creditAmount,
  });

  if (!credit?.ok) {
    await DepositModel.updateOne(
      { _id: deposit._id, status: 'pending' },
      {
        $set: {
          status: 'rejected',
          rejectionReason: 'wallet_credit_failed',
          verifiedAt: new Date(),
        },
      }
    );
    return { ok: false, error: 'wallet_credit_failed', depositId: String(deposit._id) };
  }

  const approved = await DepositModel.findOneAndUpdate(
    { _id: deposit._id, status: 'pending' },
    { $set: { status: 'approved', verifiedAmount: creditAmount, amount: creditAmount, verifiedAt: new Date() } },
    { new: true }
  );

  if (!approved) {
    console.error('[botDeposit] approval update failed — deposit left pending', {
      depositId: String(deposit._id),
      transactionId: storeTxId,
    });
    return { ok: false, error: 'wallet_credit_failed', depositId: String(deposit._id) };
  }

  try {
    await recordTransaction(uid, {
      type: 'deposit',
      amount: creditAmount,
      reference: storeTxId,
      channel: `BOT_${parsed.paymentMethod.toUpperCase()}`,
      detail: `VERIFIER:${parsed.apiReference}`,
    });
  } catch {
    /* non-blocking */
  }

  console.info('[botDeposit] approved via verifier-api', {
    userId: uid,
    transactionId: storeTxId,
    paymentMethod: parsed.paymentMethod,
    botReferenceAmount,
    verifiedAmount: creditAmount,
    amountSource: amountCheck.source,
    depositId: String(approved._id),
  });

  if (parsed.paymentMethod === 'telebirr') {
    markGloballyProcessedTelebirrTx(
      collectGlobalTelebirrDedupKeys(parsed, verified, verification.raw)
    );
  }

  void require('./financialSummaryService')
    .broadcastFinancialSummaryUpdate()
    .catch(() => {});

  return {
    ok: true,
    credited: creditAmount,
    verifiedAmount: creditAmount,
    transactionId: storeTxId,
    depositId: String(approved._id),
  };
}

const REJECTION_USER_MESSAGES = {
  transaction_already_processed: '⚠️ ይህ ግብይት አስቀድሞ ተሰርቷል።',
  transaction_in_progress: '⏳ ይህ ግብይት በማረጋገጥ ላይ ነው። እባክዎ ትንሽ ይጠብቁ።',
  message_required: '❌ እባክዎ ሙሉ የክፍያ SMS መልእክትዎን ይለጥፉ።',
  message_too_short: '❌ መልእክቱ በጣም አጭር ነው። ሙሉ የክፍያ SMS ይለጥፉ።',
  message_parse_failed: '❌ የክፍያ መልእክትዎን ማንበብ አልተቻለም። የመጀመሪያውን ሙሉ SMS ይለጥፉ።',
  transactionId_required: '❌ በመልእክትዎ ውስጥ Transaction ID አልተገኘም።',
  telebirr_verification_failed: '❌ Telebirr ማረጋገጫ አልተሳካም። የተረጋገጠ receipt አልተገኘም።',
  cbebirr_verification_failed: '❌ CBE Birr ማረጋገጫ አልተሳካም። receipt ወይም ስልክ ቁጥር ትክክል አይደለም።',
  cbebirr_params_required: '❌ CBE Birr ተቀማጭ ገንዘብ receipt number እና ስልክ ቁጥር በመልእክት ውስጥ መኖር አለበት።',
  payment_status_failed: '❌ ክፍያው በVerifier መሠረት ተሳክቶ አልተገኘም።',
  receipt_amount_missing: '❌ ከVerifier የተከፈለው መጠን ማግኘት አልተቻለም።',
  receiver_mismatch:
    '❌ ክፍያው ወደ ትክክለኛው Telebirr አካውንት አልተላከም። የእኛን አካውንት ብቻ ይክፈሉ።',
  duplicate_transaction_global:
    '⚠️ ይህ ግብይት አስቀድሞ ተረጋግጧል። የተለየ ክፍያ ይሞክሩ።',
  verification_failed: '❌ የማረጋገጫ አገልግሎት ስህተት። ቆይተው እንደገና ይሞክሩ።',
  wallet_credit_failed: '❌ Wallet ማዘመን አልተሳካም። Transaction IDዎን በመያዝ support ያግኙ።',
  verifier_timeout: '❌ የማረጋገጫ አገልግሎት ጊዜው አልፏል። ቆይተው እንደገና ይሞክሩ።',
  verifier_unreachable: '❌ የማረጋገጫ አገልግሎት ሊደርስ አልተቻለም። ትንሽ ቆይተው እንደገና ይሞክሩ።',
  verifier_disabled: '❌ የተቀማጭ ገንዘብ ማረጋገጫ ጊዜያዊ unavailable ስለሆነ አልተቻለም። ቆይተው እንደገና ይሞክሩ።',
  userId_required: '❌ ተጠቃሚ አልተለየም።',
};

function getDepositRejectionMessage(errorCode) {
  const code = normalizeString(errorCode).toLowerCase();
  if (code === 'fetch failed') {
    return REJECTION_USER_MESSAGES.verifier_unreachable;
  }
  return (
    REJECTION_USER_MESSAGES[errorCode] ||
    REJECTION_USER_MESSAGES[code] ||
    `❌ ተቀማጭ ገንዘብ ውድቅ ተደርጓል፡ ${errorCode || 'verification failed'}`
  );
}

function formatDepositSuccessMessage(result) {
  const credited = result.verifiedAmount ?? result.credited;
  return [
    '✅ ተቀማጭ ገንዘብ ተረጋግጧል',
    '',
    `መጠን: ${credited} ETB`,
    `Transaction ID: ${result.transactionId}`,
    '',
    'Play Walletዎ በተሳካ ሁኔታ ተሻሽሏል።',
  ].join('\n');
}

module.exports = {
  verifyAndApproveDeposit,
  getDepositRejectionMessage,
  formatDepositSuccessMessage,
};
