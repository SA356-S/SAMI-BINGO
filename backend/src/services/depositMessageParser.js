const { normalizeMatchId } = require('./telebirrReceiptVerifier');
const { extractTransactionNumberFromSms, extractAmountFromText, extractReceiptLinks } = require('./telebirrMessageParser');

function normalizeString(v) {
  return String(v ?? '').trim();
}

function parseAmountToken(raw) {
  const cleaned = String(raw || '')
    .replace(/,/g, '')
    .replace(/[^\d.]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function detectPaymentMethod(text) {
  const s = String(text || '').toLowerCase();
  if (
    s.includes('cbe birr') ||
    s.includes('cbebirr') ||
    s.includes('cbe-birr') ||
    /\bcbe\s*birr\b/.test(s)
  ) {
    return 'cbebirr';
  }
  if (
    s.includes('telebirr') ||
    s.includes('transactioninfo.ethiotelecom') ||
    s.includes('ethiotelecom.et')
  ) {
    return 'telebirr';
  }
  return 'telebirr';
}

function extractCbeBirrReceiptNumber(text) {
  const s = String(text || '');
  const patterns = [
    /receipt\s+number\s*[:=]\s*([A-Za-z0-9]+)/i,
    /receipt\s+no\.?\s*[:=]\s*([A-Za-z0-9]+)/i,
    /transaction\s+number\s*[:=]\s*([A-Za-z0-9]+)/i,
    /transaction\s+number\s+is\s+([A-Za-z0-9]+)/i,
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m?.[1]) return normalizeMatchId(m[1]);
  }
  return '';
}

function extractPhoneFromMessage(text) {
  const s = String(text || '');
  const m =
    s.match(/\b(251\d{9})\b/) ||
    s.match(/\b(09\d{8})\b/) ||
    s.match(/\b(9\d{8})\b/);
  if (!m?.[1]) return '';
  let phone = m[1].replace(/\D/g, '');
  if (phone.startsWith('09')) phone = `251${phone.slice(1)}`;
  else if (phone.startsWith('9') && phone.length === 9) phone = `251${phone}`;
  else if (phone.length === 10 && phone.startsWith('0')) phone = `251${phone.slice(1)}`;
  return phone;
}

/**
 * Telebirr API reference = receipt URL token (e.g. CE25...), fallback to transaction number.
 */
function getTelebirrApiReference(text, transactionNumber) {
  const links = extractReceiptLinks(text);
  if (links[0]?.urlToken) return normalizeMatchId(links[0].urlToken);
  return normalizeMatchId(transactionNumber);
}

/**
 * Parse deposit proof message for Telebirr or CBE Birr.
 */
function parseDepositMessage(rawMessage) {
  const text = normalizeString(rawMessage);
  if (!text || text.length < 10) {
    return { ok: false, error: 'message_too_short' };
  }

  const paymentMethod = detectPaymentMethod(text);
  const amount = extractAmountFromText(text) || parseAmountToken(text);

  if (paymentMethod === 'cbebirr') {
    const transactionId = extractCbeBirrReceiptNumber(text);
    const phoneNumber = extractPhoneFromMessage(text);

    console.log('[depositParse]', {
      paymentMethod,
      transactionId,
      phoneNumber,
      amount,
    });

    if (!transactionId) {
      return { ok: false, error: 'transactionId_required' };
    }

    return {
      ok: true,
      paymentMethod: 'cbebirr',
      transactionId,
      amount,
      phoneNumber,
      apiReference: transactionId,
    };
  }

  const transactionNumber = extractTransactionNumberFromSms(text);
  const receiptLinks = extractReceiptLinks(text);
  const apiReference = getTelebirrApiReference(text, transactionNumber);

  console.log('[depositParse]', {
    paymentMethod: 'telebirr',
    transactionNumber,
    apiReference,
    receiptLink: receiptLinks[0]?.url || null,
    amount,
  });

  if (!transactionNumber && !apiReference) {
    return { ok: false, error: 'transactionId_required' };
  }

  return {
    ok: true,
    paymentMethod: 'telebirr',
    transactionId: transactionNumber || apiReference,
    transactionNumber: transactionNumber || apiReference,
    amount,
    apiReference,
    receiptLink: receiptLinks[0]?.url || '',
  };
}

function parseBirrAmount(value) {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const n = parseAmountToken(String(value).replace(/\s*birr/gi, ''));
  return n;
}

function normalizeEthiopianPhone(phone) {
  let p = String(phone || '').replace(/\D/g, '');
  if (p.startsWith('09')) p = `251${p.slice(1)}`;
  if (p.length === 9 && p.startsWith('9')) p = `251${p}`;
  if (p.length === 10 && p.startsWith('0')) p = `251${p.slice(1)}`;
  return p;
}

module.exports = {
  parseDepositMessage,
  parseBirrAmount,
  normalizeEthiopianPhone,
  detectPaymentMethod,
};
