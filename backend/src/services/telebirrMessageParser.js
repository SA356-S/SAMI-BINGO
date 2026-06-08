const {
  normalizeMatchId,
  isAllowedReceiptUrl,
} = require('./telebirrReceiptVerifier');

const RECEIPT_URL_RE =
  /(?:https?:\/\/)?(?:www\.)?transactioninfo\.ethiotelecom\.et\/receipt\/([A-Za-z0-9]+)/gi;

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

function extractReceiptLinks(text) {
  const links = [];
  const s = String(text || '');
  let m;
  const re = new RegExp(RECEIPT_URL_RE.source, 'gi');
  while ((m = re.exec(s)) !== null) {
    const full = `https://transactioninfo.ethiotelecom.et/receipt/${m[1]}`;
    links.push({ url: full, urlToken: m[1] });
  }
  return links;
}

/**
 * Extract "Transaction Number" from Telebirr SMS only (not URL token / receipt ref).
 */
function extractTransactionNumberFromSms(text) {
  const s = String(text || '');

  const labelPatterns = [
    /transaction\s+number\s*[:=]\s*([A-Za-z0-9]+)/i,
    /transaction\s+number\s+is\s+([A-Za-z0-9]+)/i,
    /transaction\s+no\.?\s*[:=]\s*([A-Za-z0-9]+)/i,
    /transaction\s+no\.?\s+is\s+([A-Za-z0-9]+)/i,
  ];

  for (const re of labelPatterns) {
    const m = s.match(re);
    if (m?.[1]) {
      const id = normalizeMatchId(m[1]);
      if (id) return id;
    }
  }

  return '';
}

function extractAmountFromText(text) {
  const s = String(text || '');

  const patterns = [
    /transferred\s+ETB\s*([\d,]+(?:\.\d{1,2})?)/i,
    /transfer(?:red)?\s+(?:of\s+)?ETB\s*([\d,]+(?:\.\d{1,2})?)/i,
    /paid\s+ETB\s*([\d,]+(?:\.\d{1,2})?)/i,
    /ETB\s*([\d,]+(?:\.\d{1,2})?)\s+to\b/i,
    /([\d,]+(?:\.\d{1,2})?)\s*(?:ETB|Birr|ብር)\b/i,
    /(?:amount|መጠን)\s*[:=]?\s*([\d,]+(?:\.\d{1,2})?)/i,
  ];

  for (const re of patterns) {
    const m = s.match(re);
    if (m?.[1]) {
      const n = parseAmountToken(m[1]);
      if (n) return n;
    }
  }

  return null;
}

function extractDateTimeFromText(text) {
  const s = String(text || '');

  const patterns = [
    /\bon\s+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\s+\d{1,2}:\d{2}(?::\d{2})?)/i,
    /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\s+\d{1,2}:\d{2}(?::\d{2})?)/,
    /(\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}(?::\d{2})?)/,
  ];

  for (const re of patterns) {
    const m = s.match(re);
    if (m?.[1]) return normalizeString(m[1]);
  }

  return '';
}

/**
 * Parse a full Telebirr SMS / payment message pasted by the user.
 */
function parseTelebirrMessage(rawMessage) {
  const text = normalizeString(rawMessage);
  const errors = [];

  if (!text || text.length < 20) {
    return {
      ok: false,
      error: 'message_too_short',
      errors: ['Message is empty or too short'],
    };
  }

  const receiptLinks = extractReceiptLinks(text);
  const receiptLink = receiptLinks[0]?.url || '';

  const transactionNumber = extractTransactionNumberFromSms(text);
  const amount = extractAmountFromText(text);
  const transactionDate = extractDateTimeFromText(text);

  if (!transactionNumber) {
    errors.push('transaction_number_not_found');
  }

  if (!receiptLink || !isAllowedReceiptUrl(receiptLink)) {
    errors.push('receipt_link_not_found');
  }

  const result = {
    transactionNumber: transactionNumber || null,
    transactionId: transactionNumber || null,
    receiptLink: receiptLink || null,
    amount,
    transactionDate,
    receiptLinksFound: receiptLinks.length,
    urlToken: receiptLinks[0]?.urlToken || null,
  };

  console.log('[telebirrParse] extracted', {
    transactionNumber: result.transactionNumber,
    receiptLink: result.receiptLink,
    urlToken: result.urlToken,
    amount: result.amount,
    transactionDate: result.transactionDate,
    messagePreview: text.slice(0, 120).replace(/\s+/g, ' '),
  });

  if (!transactionNumber) {
    console.warn('[telebirrParse] failed — Transaction Number not in SMS', {
      preview: text.slice(0, 300),
      errors,
    });
    return { ok: false, error: 'message_parse_failed', errors, partial: result };
  }

  if (!receiptLink) {
    console.warn('[telebirrParse] failed — no receipt link', { transactionNumber, errors });
    return { ok: false, error: 'message_parse_failed', errors, partial: result };
  }

  return { ok: true, ...result };
}

module.exports = {
  parseTelebirrMessage,
  extractReceiptLinks,
  extractTransactionNumberFromSms,
  extractAmountFromText,
  extractDateTimeFromText,
};
