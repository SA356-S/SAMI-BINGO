/**
 * Central deposit verification + wallet credit.
 * Telegram bot and Mini App MUST call this service. Only this module talks to qbirr.
 */

const { DepositModel } = require('../models/Deposit');
const { verifyWithQbirr } = require('./qbirrClient');
const { creditDepositAsync, getWalletBalanceAsync } = require('../socket/walletManager');
const { recordTransaction } = require('./walletTransactionService');
const {
  shouldAttemptFirstDepositBonus,
  resolveFirstDepositWalletCredit,
  rollbackFirstDepositBonusClaim,
} = require('./firstDepositBonusService');
const {
  TELEBIRR_PROVIDER,
  CBE_PROVIDER,
  normalizeProvider,
  resolveReceiver,
  getPublicDepositMethods,
} = require('../config/depositAccounts');

function normalizeString(value) {
  return String(value ?? '').trim();
}

function normalizeReference(value) {
  return normalizeString(value).replace(/\s+/g, '').toUpperCase();
}

function extractTelebirrReference(raw) {
  const text = normalizeString(raw);
  if (!text) return '';

  const urlMatch = text.match(
    /transactioninfo\.ethiotelecom\.et\/receipt\/([A-Za-z0-9]+)/i
  );
  if (urlMatch?.[1]) return urlMatch[1];

  const labeled = text.match(
    /(?:transaction\s*(?:id|number|no\.?)|txn(?:\s*id)?|receipt\s*(?:id|no\.?|number)|የግብይት\s*(?:ቁጥር|መለያ)|የክፍያ\s*ቁጥር)\s*[:#=\-]?\s*([A-Za-z0-9-]{6,})/i
  );
  if (labeled?.[1]) return labeled[1];

  const compact = text.replace(/\s+/g, '');
  if (/^[A-Za-z0-9-]{6,40}$/.test(compact)) return compact;

  const tokens = text.match(/[A-Za-z0-9-]{8,24}/g) || [];
  const mixed = tokens.filter((token) => /[A-Za-z]/.test(token) && /\d/.test(token));
  if (mixed.length) return mixed[0];
  return tokens[0] || '';
}

function extractCbeReference(raw) {
  const text = normalizeString(raw);
  if (!text) return '';

  const labeled = text.match(
    /(?:transaction\s*(?:id|number|no\.?)|txn(?:\s*id)?|ft\s*(?:number|no\.?)|receipt\s*(?:id|no\.?|number)|የግብይት\s*(?:ቁጥር|መለያ)|የክፍያ\s*ቁጥር)\s*[:#=\-]?\s*([A-Za-z0-9-]{6,})/i
  );
  if (labeled?.[1]) return labeled[1];

  const ft = text.match(/\b(FT[A-Za-z0-9]{8,})\b/i);
  if (ft?.[1]) return ft[1];

  const compact = text.replace(/\s+/g, '');
  if (/^[A-Za-z0-9-]{6,40}$/.test(compact)) return compact;

  const tokens = text.match(/[A-Za-z0-9-]{8,24}/g) || [];
  const mixed = tokens.filter((token) => /[A-Za-z]/.test(token) && /\d/.test(token));
  if (mixed.length) return mixed[0];
  return tokens[0] || '';
}

function extractReceiptAmountHint(raw) {
  const text = String(raw ?? '');
  const labeled = text.match(
    /(?:amount|የተከፈለ|መጠን|birr|etb)[^\d]{0,12}(\d+(?:[.,]\d{1,2})?)/i
  );
  if (labeled?.[1]) {
    const amount = toAmount(labeled[1].replace(',', '.'));
    if (amount != null) return amount;
  }
  const suffixed = text.match(/(\d+(?:[.,]\d{1,2})?)\s*(?:ETB|Birr|ብር)/i);
  if (suffixed?.[1]) {
    return toAmount(suffixed[1].replace(',', '.'));
  }
  return null;
}

function resolveTransactionReference(provider, raw) {
  const text = normalizeString(raw);
  if (provider === TELEBIRR_PROVIDER) {
    const extracted = extractTelebirrReference(text);
    return extracted || '';
  }
  if (provider === CBE_PROVIDER) {
    const extracted = extractCbeReference(text);
    return extracted || '';
  }
  return normalizeReference(text);
}

function toAmount(value) {
  const amount = Number(String(value ?? '').replace(/,/g, '').trim());
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return Math.round(amount * 100) / 100;
}

const MIN_DEPOSIT_AMOUNT = 10;

function isBelowMinDeposit(amount) {
  return Number.isFinite(amount) && amount < MIN_DEPOSIT_AMOUNT;
}

function amountsMatch(requested, verified) {
  if (!Number.isFinite(requested) || !Number.isFinite(verified)) return false;
  return Math.round(requested * 100) === Math.round(verified * 100);
}

const USER_ERRORS = {
  userId_required: 'Your account could not be identified.',
  invalid_provider: 'Choose Telebirr or CBE Birr.',
  invalid_request: 'Please check the deposit details and try again.',
  invalid_reference: 'Enter a valid transaction / reference number.',
  invalid_amount: 'Enter a valid deposit amount.',
  amount_below_minimum: 'Minimum deposit amount is 10 ETB.',
  unknown_receiving_number: 'That Telebirr receiving number is not configured.',
  missing_receiver_configuration: 'Deposits are temporarily unavailable. Please try again later.',
  deposit_not_configured: 'Deposits are temporarily unavailable. Please try again later.',
  qbirr_timeout: 'Payment verification timed out. Please try again.',
  qbirr_unavailable: 'Payment verification is temporarily unavailable. Please try again.',
  verification_failed: 'This payment could not be verified.',
  amount_mismatch: 'The paid amount does not match the deposit amount.',
  transaction_already_processed: 'This transaction was already credited.',
  transaction_in_progress: 'This transaction is already being verified. Please wait.',
  wallet_credit_failed: 'Payment was verified but the wallet could not be updated. Contact support with your reference.',
};

const AMHARIC_ERRORS = {
  userId_required: '❌ ተጠቃሚ አልተለየም።',
  invalid_provider: '❌ Telebirr ወይም CBE Birr ይምረጡ።',
  invalid_request: '❌ የተቀማጭ መረጃውን ያስተካክሉ።',
  invalid_reference: '❌ ትክክለኛ የግብይት ቁጥር ያስገቡ።',
  invalid_amount: '❌ ትክክለኛ መጠን ያስገቡ።',
  amount_below_minimum: 'Minimum deposit amount is 10 ETB.',
  unknown_receiving_number: '❌ ይህ የTelebirr ቁጥር አልተዋቀረም።',
  missing_receiver_configuration: '❌ ተቀማጭ ጊዜያዊ unavailable ነው። ቆይተው ይሞክሩ።',
  deposit_not_configured: '❌ ተቀማጭ ጊዜያዊ unavailable ነው። ቆይተው ይሞክሩ።',
  qbirr_timeout: '❌ የማረጋገጫ ጊዜው አልፏል። ቆይተው እንደገና ይሞክሩ።',
  qbirr_unavailable: '❌ የማረጋገጫ አገልግሎት ሊደርስ አልተቻለም። ትንሽ ቆይተው ይሞክሩ።',
  verification_failed: '❌ ክፍያው ማረጋገጥ አልተቻለም።',
  amount_mismatch: '❌ የተከፈለው መጠን ከተቀማጭ መጠን ጋር አይዛመድም።',
  transaction_already_processed: '⚠️ ይህ ግብይት አስቀድሞ ተሰርቷል።',
  transaction_in_progress: '⏳ ይህ ግብይት በማረጋገጥ ላይ ነው። እባክዎ ትንሽ ይጠብቁ።',
  wallet_credit_failed:
    '❌ Wallet ማዘመን አልተሳካም። Transaction IDዎን በመያዝ support ያግኙ።',
};

function getDepositErrorMessage(errorCode, locale = 'en') {
  const code = normalizeString(errorCode);
  const table = locale === 'am' ? AMHARIC_ERRORS : USER_ERRORS;
  return table[code] || USER_ERRORS.verification_failed;
}

function getDepositRejectionMessage(errorCode) {
  return getDepositErrorMessage(errorCode, 'am');
}

function formatDepositSuccessMessage(result) {
  const credited = result.verifiedAmount ?? result.credited;
  const play = result.playWallet;
  const lines = [
    '✅ ተቀማጭ ገንዘብ ተረጋግጧል',
    '',
    `መጠን: ${credited} ETB`,
    `Transaction ID: ${result.transactionId}`,
  ];
  if (Number.isFinite(Number(play))) {
    lines.push(`Play Wallet: ${play} ETB`);
  }
  lines.push('', 'Play Walletዎ በተሳካ ሁኔታ ተሻሽሏል።');
  return lines.join('\n');
}

function fail(error, extra = {}) {
  return { ok: false, error, ...extra };
}

async function defaultFindByReference(transactionId) {
  return DepositModel.findOne({ transactionId }).lean();
}

async function defaultInsertPending(doc) {
  const created = await DepositModel.create(doc);
  return created.toObject ? created.toObject() : created;
}

async function defaultMarkStatus(transactionId, set) {
  return DepositModel.findOneAndUpdate(
    { transactionId },
    { $set: set },
    { new: true }
  ).lean();
}

async function defaultClaimForCredit(transactionId) {
  return DepositModel.findOneAndUpdate(
    {
      transactionId,
      walletCredited: { $ne: true },
      status: { $ne: 'approved' },
    },
    { $set: { status: 'pending' } },
    { new: true }
  ).lean();
}

async function defaultCreditWallet(userId, amount, meta) {
  return creditDepositAsync(userId, amount, meta);
}

async function defaultRecordTransaction(userId, row) {
  return recordTransaction(userId, row);
}

function createDefaultDeps() {
  return {
    verifyQbirr: verifyWithQbirr,
    findByReference: defaultFindByReference,
    insertPending: defaultInsertPending,
    markStatus: defaultMarkStatus,
    claimForCredit: defaultClaimForCredit,
    creditWallet: defaultCreditWallet,
    recordTx: defaultRecordTransaction,
    getWallet: getWalletBalanceAsync,
    applyFirstDepositBonus: true,
  };
}

/**
 * Verify a deposit through qbirr, then credit the shared MongoDB wallet once.
 *
 * @param {{
 *   userId: string,
 *   provider: string,
 *   reference: string,
 *   amount: number,
 *   receivingNumber?: string,
 *   source?: 'bot'|'miniapp',
 * }} input
 */
async function verifyAndCreditDeposit(input = {}, deps = {}) {
  const d = { ...createDefaultDeps(), ...deps };

  const userId = normalizeString(input.userId);
  const provider = normalizeProvider(input.provider);
  const reference = resolveTransactionReference(provider, input.reference);
  const requestedAmount = toAmount(input.amount);
  const source = input.source === 'bot' ? 'bot' : 'miniapp';

  if (!userId) return fail('userId_required');
  if (!provider) return fail('invalid_provider');
  if (!reference || reference.length < 4) return fail('invalid_reference');

  const receiver = resolveReceiver(provider, input.receivingNumber);
  if (!receiver.ok) return fail(receiver.error);

  const existing = await d.findByReference(reference);
  if (existing?.walletCredited || existing?.status === 'approved') {
    return fail('transaction_already_processed');
  }
  if (existing?.status === 'pending') {
    const ageMs = Date.now() - new Date(existing.updatedAt || existing.createdAt || 0).getTime();
    if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs < 60_000) {
      return fail('transaction_in_progress');
    }
  }

  const qbirrExpectedAmount =
    requestedAmount ?? extractReceiptAmountHint(input.reference);
  // Telebirr may be submitted as a reference number only (no SMS amount).
  // CBE still requires an amount from the typed value or receipt text.
  if (qbirrExpectedAmount == null && provider !== TELEBIRR_PROVIDER) {
    return fail('invalid_amount');
  }
  if (isBelowMinDeposit(requestedAmount) || isBelowMinDeposit(qbirrExpectedAmount)) {
    return fail('amount_below_minimum');
  }

  const qbirrPayload = {
    provider: receiver.provider,
    ref: reference,
    receiver_name: receiver.receiverName,
  };
  if (qbirrExpectedAmount != null) {
    qbirrPayload.amount = qbirrExpectedAmount;
  }
  if (receiver.provider === CBE_PROVIDER) {
    qbirrPayload.receiver_account = receiver.receiverAccount;
  }

  const qbirrResult = await d.verifyQbirr(qbirrPayload);
  if (!qbirrResult?.ok) {
    if (existing) {
      await d.markStatus(reference, {
        status: 'rejected',
        rejectionReason: qbirrResult?.error || 'verification_failed',
        qbirrVerified: false,
        qbirrError: qbirrResult?.qbirr?.error || qbirrResult?.error || '',
        verifiedAt: new Date(),
      }).catch(() => null);
    } else {
      await d
        .insertPending({
          userId,
          transactionId: reference,
          provider: receiver.provider,
          paymentMethod: receiver.provider,
          source,
          requestedAmount: requestedAmount ?? qbirrExpectedAmount ?? 0,
          submittedAmount: requestedAmount ?? qbirrExpectedAmount ?? 0,
          amount: requestedAmount ?? qbirrExpectedAmount ?? 0,
          status: 'rejected',
          walletCredited: false,
          receivingNumber: receiver.receivingNumber,
          receiverName: receiver.receiverName,
          receiverAccount: receiver.receiverAccount || '',
          qbirrVerified: false,
          qbirrPayer: qbirrResult?.qbirr?.payer || '',
          qbirrAmount: qbirrResult?.qbirr?.amount ?? null,
          qbirrError: qbirrResult?.qbirr?.error || qbirrResult?.error || '',
          rejectionReason: qbirrResult?.error || 'verification_failed',
          verifiedAt: new Date(),
        })
        .catch((err) => {
          if (String(err?.code) === '11000') return null;
          throw err;
        });
    }
    return fail(qbirrResult?.error || 'verification_failed');
  }

  const qbirr = qbirrResult.qbirr || {};
  if (qbirr.verified !== true) {
    await persistRejected({
      d,
      existing,
      userId,
      reference,
      receiver,
      source,
      requestedAmount: requestedAmount ?? qbirrExpectedAmount,
      qbirr,
      reason: 'verification_failed',
    });
    return fail('verification_failed');
  }

  const verifiedAmount = toAmount(qbirr.amount);
  if (verifiedAmount == null) {
    await persistRejected({
      d,
      existing,
      userId,
      reference,
      receiver,
      source,
      requestedAmount: requestedAmount ?? qbirrExpectedAmount,
      qbirr,
      reason: 'verification_failed',
    });
    return fail('verification_failed');
  }
  if (isBelowMinDeposit(verifiedAmount)) {
    await persistRejected({
      d,
      existing,
      userId,
      reference,
      receiver,
      source,
      requestedAmount: requestedAmount ?? qbirrExpectedAmount ?? verifiedAmount,
      qbirr,
      reason: 'amount_below_minimum',
      verifiedAmount,
    });
    return fail('amount_below_minimum');
  }
  if (requestedAmount != null && !amountsMatch(requestedAmount, verifiedAmount)) {
    await persistRejected({
      d,
      existing,
      userId,
      reference,
      receiver,
      source,
      requestedAmount,
      qbirr,
      reason: 'amount_mismatch',
      verifiedAmount,
    });
    return fail('amount_mismatch');
  }

  let deposit = existing;
  if (!deposit) {
    try {
      deposit = await d.insertPending({
        userId,
        transactionId: reference,
        provider: receiver.provider,
        paymentMethod: receiver.provider,
        source,
        requestedAmount: requestedAmount ?? qbirrExpectedAmount ?? verifiedAmount,
        submittedAmount: requestedAmount ?? qbirrExpectedAmount ?? verifiedAmount,
        amount: requestedAmount ?? qbirrExpectedAmount ?? verifiedAmount,
        verifiedAmount,
        status: 'pending',
        walletCredited: false,
        receivingNumber: receiver.receivingNumber,
        receiverName: receiver.receiverName,
        receiverAccount: receiver.receiverAccount || '',
        qbirrVerified: true,
        qbirrPayer: qbirr.payer || '',
        qbirrAmount: verifiedAmount,
        qbirrError: '',
        senderName: qbirr.payer || '',
        paymentStatus: 'verified',
      });
    } catch (err) {
      if (String(err?.code) === '11000') {
        const raced = await d.findByReference(reference);
        if (raced?.walletCredited || raced?.status === 'approved') {
          return fail('transaction_already_processed');
        }
        if (raced?.status === 'pending') {
          return fail('transaction_in_progress');
        }
        return fail('transaction_already_processed');
      }
      throw err;
    }
  }

  if (deposit?.walletCredited || deposit?.status === 'approved') {
    return fail('transaction_already_processed');
  }

  const claimed = await d.claimForCredit(reference);
  if (!claimed || claimed.walletCredited || claimed.status === 'approved') {
    return fail('transaction_already_processed');
  }

  let walletCreditAmount = verifiedAmount;
  let bonusCredit = {
    creditedAmount: verifiedAmount,
    bonusAmount: 0,
    bonusApplied: false,
    bonusPercent: 0,
  };

  if (d.applyFirstDepositBonus && (await shouldAttemptFirstDepositBonus(userId))) {
    bonusCredit = await resolveFirstDepositWalletCredit(userId, verifiedAmount);
    walletCreditAmount = bonusCredit.creditedAmount;
  }

  const credit = await d.creditWallet(userId, walletCreditAmount, {
    depositId: String(deposit?._id || reference),
    transactionId: reference,
    paymentMethod: receiver.provider,
    submittedAmount: requestedAmount ?? verifiedAmount,
    verifiedAmount,
  });

  if (!credit?.ok) {
    if (bonusCredit.bonusApplied) {
      await rollbackFirstDepositBonusClaim(userId).catch(() => {});
    }
    await d.markStatus(reference, {
      status: 'rejected',
      rejectionReason: 'wallet_credit_failed',
      walletCredited: false,
      verifiedAt: new Date(),
    });
    return fail('wallet_credit_failed');
  }

  const approved = await d.markStatus(reference, {
    status: 'approved',
    walletCredited: true,
    verifiedAmount,
    amount: verifiedAmount,
    qbirrVerified: true,
    qbirrPayer: qbirr.payer || '',
    qbirrAmount: verifiedAmount,
    qbirrError: '',
    senderName: qbirr.payer || '',
    paymentStatus: 'verified',
    verifiedAt: new Date(),
    rejectionReason: '',
  });

  if (!approved) {
    return fail('wallet_credit_failed');
  }

  try {
    await d.recordTx(userId, {
      type: 'deposit',
      amount: verifiedAmount,
      reference,
      channel: `${source === 'bot' ? 'BOT' : 'APP'}_${receiver.provider.toUpperCase()}`,
      detail: `QBIRR:${reference}`,
    });
  } catch {
    /* history is non-blocking */
  }

  if (bonusCredit.bonusApplied) {
    try {
      await d.recordTx(userId, {
        type: 'deposit',
        amount: bonusCredit.bonusAmount,
        reference,
        channel: 'FIRST_DEPOSIT_BONUS',
        detail: `First deposit bonus ${bonusCredit.bonusPercent}%`,
      });
    } catch {
      /* non-blocking */
    }
  }

  let playWallet = credit.wallet?.play;
  try {
    const wallet = await d.getWallet?.(userId);
    if (wallet && Number.isFinite(Number(wallet.playWallet))) {
      playWallet = wallet.playWallet;
    } else if (wallet && Number.isFinite(Number(wallet.play))) {
      playWallet = wallet.play;
    }
  } catch {
    /* optional */
  }

  try {
    void require('./financialSummaryService').broadcastFinancialSummaryUpdate().catch(() => {});
  } catch {
    /* optional */
  }

  return {
    ok: true,
    credited: walletCreditAmount,
    verifiedAmount,
    firstDepositBonus: bonusCredit.bonusApplied ? bonusCredit.bonusAmount : 0,
    transactionId: reference,
    provider: receiver.provider,
    depositId: String(approved._id || deposit?._id || ''),
    playWallet: Number.isFinite(Number(playWallet)) ? Number(playWallet) : undefined,
    mainWallet: credit.wallet?.main,
  };
}

async function persistRejected({
  d,
  existing,
  userId,
  reference,
  receiver,
  source,
  requestedAmount,
  qbirr,
  reason,
  verifiedAmount = null,
}) {
  const recordedAmount = toAmount(requestedAmount) ?? 0;
  const set = {
    status: 'rejected',
    walletCredited: false,
    rejectionReason: reason,
    qbirrVerified: qbirr?.verified === true,
    qbirrPayer: qbirr?.payer || '',
    qbirrAmount: qbirr?.amount ?? null,
    qbirrError: qbirr?.error || reason,
    verifiedAmount: verifiedAmount,
    verifiedAt: new Date(),
  };

  if (existing) {
    await d.markStatus(reference, set).catch(() => null);
    return;
  }

  await d
    .insertPending({
      userId,
      transactionId: reference,
      provider: receiver.provider,
      paymentMethod: receiver.provider,
      source,
      requestedAmount: recordedAmount,
      submittedAmount: recordedAmount,
      amount: recordedAmount,
      receivingNumber: receiver.receivingNumber,
      receiverName: receiver.receiverName,
      receiverAccount: receiver.receiverAccount || '',
      ...set,
    })
    .catch((err) => {
      if (String(err?.code) === '11000') return null;
      throw err;
    });
}

module.exports = {
  TELEBIRR_PROVIDER,
  CBE_PROVIDER,
  verifyAndCreditDeposit,
  getPublicDepositMethods,
  getDepositErrorMessage,
  getDepositRejectionMessage,
  formatDepositSuccessMessage,
  normalizeReference,
  extractTelebirrReference,
  extractCbeReference,
  extractReceiptAmountHint,
  toAmount,
  amountsMatch,
  MIN_DEPOSIT_AMOUNT,
};
