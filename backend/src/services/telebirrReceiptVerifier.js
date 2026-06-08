const https = require('https');
const http = require('http');
const { URL } = require('url');
const { getReceiverConfigForVerification } = require('../config/paymentMethods');

const DEFAULT_TIMEOUT_MS = Number(process.env.TELEBIRR_RECEIPT_TIMEOUT_MS) || 12000;
const RECEIPT_HOSTS = new Set([
  'transactioninfo.ethiotelecom.et',
  'ethiotelecom.et',
  'www.ethiotelecom.et',
]);

const SUCCESS_STATUS = new Set([
  'success',
  'successful',
  'completed',
  'complete',
  'paid',
  'settled',
  'approved',
]);

function normalizeString(v) {
  return String(v ?? '').trim();
}

function normalizeTxId(v) {
  return normalizeString(v).toUpperCase().replace(/\s+/g, '');
}

/** Normalize IDs used for SMS Transaction Number ↔ Receipt Invoice No matching. */
function normalizeMatchId(v) {
  const s = normalizeString(v);
  if (!s) return '';
  const token = s.match(/[A-Za-z0-9]+/);
  return token ? token[0].toUpperCase() : '';
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseAmountToken(raw) {
  const cleaned = String(raw || '')
    .replace(/,/g, '')
    .replace(/[^\d.]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function extractByLabels(text, labels) {
  for (const label of labels) {
    const re = new RegExp(
      `${label}\\s*[:\\-]?\\s*([\\d,]+(?:\\.\\d+)?)\\s*(?:ETB|Birr|ብር)?`,
      'i'
    );
    const m = text.match(re);
    if (m?.[1]) {
      const n = parseAmountToken(m[1]);
      if (n) return n;
    }
  }
  return null;
}

function extractField(text, labels) {
  for (const label of labels) {
    const re = new RegExp(`${label}\\s*[:\\-]?\\s*([^\\n|]+)`, 'i');
    const m = text.match(re);
    if (!m?.[1]) continue;
    let val = normalizeString(m[1]);
    val = val.split(
      /\s{2,}|\s+(?=(?:Settled|Transferred|Transaction|Invoice|Amount|Credited|Payer)\b)/i
    )[0];
    return val.trim();
  }
  return '';
}

/**
 * Extract Invoice No / የክፍያ ቁጥር from official receipt page ONLY.
 * Do NOT use URL path tokens, Transaction Number, Receipt No, or generic refs.
 */
function extractInvoiceNo(text) {
  const labels = [
    'Invoice No',
    'Invoice NO',
    'Invoice Number',
    'Invoice #',
    'የክፍያ ቁጥር',
  ];

  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(
      `${escaped}\\s*[:\\-]?\\s*([A-Za-z0-9][A-Za-z0-9\\s-]{0,40})`,
      'i'
    );
    const m = text.match(re);
    if (!m?.[1]) continue;
    const id = normalizeMatchId(m[1]);
    if (id) return id;
  }

  return '';
}

function extractStatus(text) {
  const status = extractField(text, [
    'Transaction Status',
    'Payment Status',
    'Status',
    'የክፍያ ሁኔታ',
  ]);
  return normalizeString(status);
}

function digitsOnly(v) {
  return String(v ?? '').replace(/\D/g, '');
}

function isSuccessStatus(status, fullText = '') {
  const s = normalizeString(status).toLowerCase();
  if (s) {
    if (SUCCESS_STATUS.has(s)) return true;
    if (/\b(success|completed|paid|settled)\b/i.test(s)) return true;
  }
  const t = String(fullText || '');
  return /\b(transaction\s+successful|payment\s+successful|successfully\s+completed|completed\s+successfully)\b/i.test(
    t
  );
}

function extractAmount(text) {
  const priority = extractByLabels(text, [
    'Settled Amount',
    'Transferred Amount',
    'Transaction Amount',
    'Paid Amount',
    'Amount',
    'የተከፈለ መጠን',
  ]);
  if (priority) return priority;

  const etbMatches = [...text.matchAll(/([\d,]+(?:\.\d+)?)\s*(?:ETB|Birr|ብር)/gi)];
  if (etbMatches.length) {
    const amounts = etbMatches
      .map((m) => parseAmountToken(m[1]))
      .filter((n) => n != null);
    if (amounts.length) return Math.min(...amounts);
  }

  return null;
}

function extractTxIdFromUrl(receiptUrl) {
  try {
    const u = new URL(receiptUrl);
    const pathMatch = u.pathname.match(/\/receipt\/([^/?#]+)/i);
    if (pathMatch?.[1]) return normalizeTxId(pathMatch[1]);
    const q =
      u.searchParams.get('receiptNo') ||
      u.searchParams.get('receipt') ||
      u.searchParams.get('id');
    if (q) return normalizeTxId(q);
  } catch {
    /* ignore */
  }
  return '';
}

function isAllowedReceiptUrl(receiptUrl) {
  try {
    const u = new URL(receiptUrl);
    if (!['http:', 'https:'].includes(u.protocol)) return false;
    const host = u.hostname.toLowerCase();
    if (RECEIPT_HOSTS.has(host)) return true;
    return host.endsWith('.ethiotelecom.et');
  } catch {
    return false;
  }
}

function buildReceiptUrl(receiptLink, transactionId) {
  const link = normalizeString(receiptLink);
  if (link) {
    if (isAllowedReceiptUrl(link)) return link;
    return null;
  }
  const tx = normalizeTxId(transactionId);
  if (!tx) return null;
  return `https://transactioninfo.ethiotelecom.et/receipt/${encodeURIComponent(tx)}`;
}

function fetchHtml(url, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      resolve({ ok: false, status: 0, text: '', error: 'invalid_receipt_url' });
      return;
    }

    const lib = parsed.protocol === 'https:' ? https : http;
    let done = false;

    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      req.destroy();
      resolve({ ok: false, status: 0, text: '', error: 'receipt_fetch_timeout' });
    }, timeoutMs);

    const req = lib.request(
      url,
      {
        method: 'GET',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          if (data.length < 500000) data += chunk;
        });
        res.on('end', () => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          const ok = res.statusCode >= 200 && res.statusCode < 400;
          resolve({
            ok,
            status: res.statusCode,
            text: data,
            error: ok ? null : 'official_link_unreachable',
          });
        });
      }
    );

    req.on('error', () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ ok: false, status: 0, text: '', error: 'official_link_unreachable' });
    });

    req.end();
  });
}

function parseJsonFieldsFromHtml(html) {
  const out = {};
  const raw = String(html || '');

  const pairs = [
    [/"(?:invoiceNo|invoiceNumber|invoice_no)"\s*:\s*"([^"]+)"/i, 'invoiceNo'],
    [/"status"\s*:\s*"([^"]+)"/i, 'paymentStatus'],
    [/"transactionStatus"\s*:\s*"([^"]+)"/i, 'paymentStatus'],
    [/"settledAmount"\s*:\s*"?([\d.]+)"?/i, 'amount'],
    [/"paidAmount"\s*:\s*"?([\d.]+)"?/i, 'amount'],
    [/"amount"\s*:\s*"?([\d.]+)"?/i, 'amount'],
    [/"payerName"\s*:\s*"([^"]+)"/i, 'senderName'],
    [/"receiverName"\s*:\s*"([^"]+)"/i, 'receiverName'],
  ];

  for (const [re, key] of pairs) {
    const m = raw.match(re);
    if (!m?.[1]) continue;
    if (key === 'amount') out.amount = parseAmountToken(m[1]);
    else if (key === 'invoiceNo') out.invoiceNo = normalizeMatchId(m[1]);
    else out[key] = normalizeString(m[1]);
  }

  return out;
}

function parseTelebirrReceiptHtml(html) {
  const plain = stripHtml(html);
  const jsonFields = parseJsonFieldsFromHtml(html);

  const invoiceNo = extractInvoiceNo(plain) || jsonFields.invoiceNo || '';
  const paymentStatus = extractStatus(plain) || jsonFields.paymentStatus || '';
  const amount = extractAmount(plain) || jsonFields.amount || null;
  const senderName =
    jsonFields.senderName ||
    extractField(plain, [
    'Payer Name',
    'Payer',
    'Customer Name',
    'Sender Name',
    'From',
    'የከፋይ ስም',
  ]);
  const receiverName =
    jsonFields.receiverName ||
    extractField(plain, [
    'Credited Party Name',
    'Receiver Name',
    'Beneficiary Name',
    'To',
    'የተቀባይ ስም',
  ]);
  const receiverAccount = extractField(plain, [
    'Credited Party Account',
    'Receiver Account',
    'Beneficiary Account',
    'Account Number',
    'Phone Number',
    'የተቀባይ ቁጥር',
  ]);
  const transactionDate = extractField(plain, [
    'Transaction Date',
    'Payment Date',
    'Date',
    'Time',
    'የክፍያ ቀን',
  ]);

  return {
    invoiceNo,
    paymentStatus,
    amount,
    senderName,
    receiverName,
    receiverAccount,
    transactionDate,
    rawTextSample: plain.slice(0, 500),
  };
}

function phoneMatchesInText(fullPlain, expectedPhone) {
  const exp = digitsOnly(expectedPhone);
  if (!exp) return true;
  const text = digitsOnly(fullPlain);
  if (text.includes(exp)) return true;
  if (exp.length >= 9 && text.includes(exp.slice(-9))) return true;
  return false;
}

function receiverMatches(parsed, expected) {
  const expectedName = normalizeString(expected.receiverName).toLowerCase();
  const expectedAccount = digitsOnly(expected.receiverAccount);

  const parsedName = normalizeString(parsed.receiverName).toLowerCase();
  const parsedAccount = digitsOnly(parsed.receiverAccount);

  const plain = normalizeString(parsed.rawTextSample || '').toLowerCase();
  const fullPlain = normalizeString(parsed._fullPlain || '').toLowerCase();

  const nameOk =
    !expectedName ||
    parsedName.includes(expectedName) ||
    plain.includes(expectedName) ||
    fullPlain.includes(expectedName);

  const accountOk =
    phoneMatchesInText(fullPlain, expected.receiverAccount) ||
    (!expectedAccount && !expected.receiverAccount) ||
    (expectedAccount &&
      (parsedAccount.includes(expectedAccount) ||
        plain.includes(expectedAccount) ||
        fullPlain.includes(expectedAccount)));

  return nameOk && accountOk;
}

async function verifyTelebirrReceipt({
  submittedTransactionNumber,
  receiptLink,
  paymentMethod = 'telebirr',
}) {
  const smsTransactionNumber = normalizeMatchId(submittedTransactionNumber);
  if (!smsTransactionNumber) {
    return { ok: false, error: 'transactionId_required' };
  }

  const receiptUrl = buildReceiptUrl(receiptLink, null);
  if (!receiptUrl) {
    return { ok: false, error: 'invalid_receipt_link' };
  }

  const fetchResult = await fetchHtml(receiptUrl);
  if (!fetchResult.ok || !fetchResult.text) {
    console.warn('[telebirrReceipt] fetch failed', {
      url: receiptUrl,
      status: fetchResult.status,
      error: fetchResult.error,
    });
    return { ok: false, error: fetchResult.error || 'official_link_unreachable' };
  }

  const parsed = parseTelebirrReceiptHtml(fetchResult.text);
  parsed._fullPlain = stripHtml(fetchResult.text).toLowerCase();

  if (!parsed.invoiceNo) {
    console.warn('[telebirrReceipt] parse failed — no invoice no', {
      url: receiptUrl,
      smsTransactionNumber,
      sample: parsed.rawTextSample,
    });
    return { ok: false, error: 'receipt_parse_failed' };
  }

  if (parsed.invoiceNo !== smsTransactionNumber) {
    console.warn('[telebirrReceipt] invoice mismatch', {
      smsTransactionNumber,
      receiptInvoiceNo: parsed.invoiceNo,
      url: receiptUrl,
    });
    return {
      ok: false,
      error: 'transaction_mismatch',
      details: {
        smsTransactionNumber,
        receiptInvoiceNo: parsed.invoiceNo,
      },
    };
  }

  console.info('[telebirrReceipt] invoice match ok', {
    smsTransactionNumber,
    receiptInvoiceNo: parsed.invoiceNo,
  });

  if (!isSuccessStatus(parsed.paymentStatus, parsed._fullPlain)) {
    return {
      ok: false,
      error: 'payment_status_failed',
      details: { status: parsed.paymentStatus || 'unknown' },
    };
  }

  if (!parsed.amount || parsed.amount <= 0) {
    return { ok: false, error: 'receipt_amount_missing' };
  }

  const receiver = getReceiverConfigForVerification(paymentMethod);
  if (!receiverMatches(parsed, receiver)) {
    return { ok: false, error: 'receiver_mismatch' };
  }

  return {
    ok: true,
    receiptUrl,
    verified: {
      transactionId: parsed.invoiceNo,
      invoiceNo: parsed.invoiceNo,
      verifiedAmount: parsed.amount,
      paymentStatus: parsed.paymentStatus,
      senderName: parsed.senderName,
      receiverName: parsed.receiverName || receiver.receiverName,
      receiverAccount: parsed.receiverAccount || receiver.receiverAccount,
      transactionDate: parsed.transactionDate,
    },
  };
}

module.exports = {
  buildReceiptUrl,
  parseTelebirrReceiptHtml,
  verifyTelebirrReceipt,
  normalizeTxId,
  normalizeMatchId,
  extractInvoiceNo,
  isAllowedReceiptUrl,
};
