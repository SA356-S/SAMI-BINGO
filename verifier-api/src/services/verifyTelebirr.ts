import axios, { AxiosError } from "axios";
import * as cheerio from "cheerio";
import logger from '../utils/logger';

export interface TelebirrReceipt {
    payerName: string;
    payerTelebirrNo: string;
    creditedPartyName: string;
    creditedPartyAccountNo: string;
    transactionStatus: string;
    receiptNo: string;
    paymentDate: string;
    settledAmount: string;
    serviceFee: string;
    serviceFeeVAT: string;
    totalPaidAmount: string;
    bankName: string;
    customerNote: string;
}

/**
 * Enhanced regex-based extractor for settled amount - multiple patterns like PHP version
 * @param htmlContent The raw HTML content
 * @returns Extracted settled amount or null
 */
function extractSettledAmountRegex(htmlContent: string): string | null {
    // Pattern 1: Direct match with the exact text structure
    const pattern1 = /የተከፈለው\s+መጠን\/Settled\s+Amount.*?<\/td>\s*<td[^>]*>\s*([\d,]+(?:\.\d+)?\s+Birr)/is;
    let match = htmlContent.match(pattern1);
    if (match) return match[1].trim();

    // Pattern 2: Look for the table row structure
    const pattern2 = /<tr[^>]*>.*?የተከፈለው\s+መጠን\/Settled\s+Amount.*?<td[^>]*>\s*([\d,]+(?:\.\d+)?\s+Birr)/is;
    match = htmlContent.match(pattern2);
    if (match) return match[1].trim();

    // Pattern 3: More flexible approach - look for any cell containing "Settled Amount" followed by amount
    const pattern3 = /Settled\s+Amount.*?([\d,]+(?:\.\d+)?\s+Birr)/is;
    match = htmlContent.match(pattern3);
    if (match) return match[1].trim();

    // Pattern 4: Look specifically in the transaction details table
    const pattern4 = /የክፍያ\s+ዝርዝር\/Transaction\s+details.*?<tr[^>]*>.*?<td[^>]*>\s*[^<]*<\/td>\s*<td[^>]*>\s*[^<]*<\/td>\s*<td[^>]*>\s*([\d,]+(?:\.\d+)?\s+Birr)/is;
    match = htmlContent.match(pattern4);
    if (match) return match[1].trim();

    return null;
}

/**
 * Enhanced regex-based extractor for service fee
 * @param htmlContent The raw HTML content
 * @returns Extracted service fee or null
 */
function extractServiceFeeRegex(htmlContent: string): string | null {
    // Pattern to match "የአገልግሎት ክፍያ/Service fee" followed by amount in Birr
    // Make sure we don't match VAT version
    const pattern = /የአገልግሎት\s+ክፍያ\/Service\s+fee(?!\s+ተ\.እ\.ታ).*?<\/td>\s*<td[^>]*>\s*([\d,]+(?:\.\d+)?\s+Birr)/i;
    const match = htmlContent.match(pattern);
    if (match) return match[1].trim();

    return null;
}

/**
 * Enhanced regex-based extractor for receipt number
 * @param htmlContent The raw HTML content
 * @returns Extracted receipt number or null
 */
function extractReceiptNoRegex(htmlContent: string): string | null {
    // Extract receipt number from the transaction details table
    const pattern = /<td[^>]*class="[^"]*receipttableTd[^"]*receipttableTd2[^"]*"[^>]*>\s*([A-Z0-9]+)\s*<\/td>/i;
    const match = htmlContent.match(pattern);
    if (match) return match[1].trim();

    return null;
}

/**
 * Enhanced regex-based extractor for payment date
 * @param htmlContent The raw HTML content
 * @returns Extracted payment date or null
 */
function extractDateRegex(htmlContent: string): string | null {
    // Extract date in format DD-MM-YYYY HH:MM:SS
    const pattern = /(\d{2}-\d{2}-\d{4}\s+\d{2}:\d{2}:\d{2})/;
    const match = htmlContent.match(pattern);
    if (match) return match[1].trim();

    return null;
}

/**
 * Generic regex extractor for other fields
 * @param htmlContent The raw HTML content
 * @param labelPattern The label to search for
 * @param valuePattern The pattern for the value (defaults to capturing any non-tag content)
 * @returns Extracted value or null
 */
function extractWithRegex(htmlContent: string, labelPattern: string, valuePattern: string = '([^<]+)'): string | null {
    // Escape special regex characters in the label pattern
    const escapedLabel = labelPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`${escapedLabel}.*?<\\/td>\\s*<td[^>]*>\\s*${valuePattern}`, 'i');
    const match = htmlContent.match(pattern);
    if (match) return match[1].replace(/<[^>]*>/g, '').trim(); // Strip any remaining HTML tags

    return null;
}

/**
 * Regex-based extractor for settled amount and service fee as fallback
 * @param htmlContent The raw HTML content
 * @returns Object containing extracted values
 */
function extractWithRegexLegacy(htmlContent: string): { settledAmount: string | null; serviceFee: string | null } {
    // Use the new enhanced extractors
    const settledAmount = extractSettledAmountRegex(htmlContent);
    const serviceFee = extractServiceFeeRegex(htmlContent);

    return {
        settledAmount,
        serviceFee
    };
}

/**
 * Scrapes Telebirr receipt data from HTML content
 * @param html The HTML content to scrape
 * @returns Extracted Telebirr receipt data
 */
function scrapeTelebirrReceipt(html: string): TelebirrReceipt {
    const $ = cheerio.load(html);

    // Log HTML content in debug mode to help diagnose scraping issues
    logger.debug(`HTML content length: ${html.length} bytes`);
    if (html.length < 100) {
        logger.warn(`Suspiciously short HTML response: ${html}`);
    }

    const getText = (selector: string): string =>
        $(selector).next().text().trim();

    const getPaymentDate = (): string => {
        // First try regex extraction
        const regexDate = extractDateRegex(html);
        if (regexDate) return regexDate;

        // Fallback to cheerio
        return $('.receipttableTd').filter((_, el) => $(el).text().includes("-202")).first().text().trim();
    };

    const getReceiptNo = (): string => {
        // First try regex extraction
        const regexReceiptNo = extractReceiptNoRegex(html);
        if (regexReceiptNo) return regexReceiptNo;

        // Fallback to cheerio
        return $('td.receipttableTd.receipttableTd2')
            .eq(1) // second match: the value, not the label
            .text()
            .trim();
    };

    const getSettledAmount = (): string => {
        // First try the enhanced regex approach
        const regexAmount = extractSettledAmountRegex(html);
        if (regexAmount) return regexAmount;

        // Fallback to cheerio approach
        let amount = $('td.receipttableTd.receipttableTd2')
            .filter((_, el) => {
                const prevTd = $(el).prev();
                return prevTd.text().includes("የተከፈለው መጠን") || prevTd.text().includes("Settled Amount");
            })
            .text()
            .trim();

        // If that doesn't work, try looking in the transaction details table
        if (!amount) {
            amount = $('tr')
                .filter((_, el) => {
                    return $(el).find('td').first().text().includes("የተከፈለው መጠን") ||
                        $(el).find('td').first().text().includes("Settled Amount");
                })
                .find('td')
                .last()
                .text()
                .trim();
        }

        return amount;
    };

    const getServiceFee = (): string => {
        // First try the enhanced regex approach
        const regexFee = extractServiceFeeRegex(html);
        if (regexFee) return regexFee;

        // Fallback to cheerio approach - look for service fee but not service fee VAT
        let fee = $('td.receipttableTd1')
            .filter((_, el) => {
                const text = $(el).text();
                return (text.includes("የአገልግሎት ክፍያ") || text.includes("Service fee")) &&
                    !text.includes("ተ.እ.ታ") && !text.includes("VAT");
            })
            .next('td.receipttableTd.receipttableTd2')
            .text()
            .trim();

        // Alternative approach - look in table rows
        if (!fee) {
            fee = $('tr')
                .filter((_, el) => {
                    const text = $(el).text();
                    return (text.includes("የአገልግሎት ክፍያ") || text.includes("Service fee")) &&
                        !text.includes("ተ.እ.ታ") && !text.includes("VAT");
                })
                .find('td')
                .last()
                .text()
                .trim();
        }

        return fee;
    };

    // Helper function to extract text using regex first, then cheerio
    const getTextWithFallback = (labelText: string, cheerioSelector?: string): string => {
        // Try regex first
        const regexResult = extractWithRegex(html, labelText);
        if (regexResult) return regexResult;

        // Fallback to cheerio if selector provided
        if (cheerioSelector) {
            return getText(cheerioSelector);
        }

        // Default cheerio approach
        return getText(`td:contains("${labelText}")`);
    };

    logger.debug("SERVICE FEE: ", getServiceFee());
    logger.debug("SETTLED AMOUNT: ", getSettledAmount());

    // Get regex results as backup for debugging
    const regexResults = extractWithRegexLegacy(html);
    logger.debug("Regex results:", regexResults);

    let creditedPartyName = getTextWithFallback("የገንዘብ ተቀባይ ስም/Credited Party name");
    let creditedPartyAccountNo = getTextWithFallback("የገንዘብ ተቀባይ ቴሌብር ቁ./Credited party account no");
    let bankName = "";

    const bankAccountNumberRaw = getTextWithFallback("የባንክ አካውንት ቁጥር/Bank account number");

    if (bankAccountNumberRaw) {
        bankName = creditedPartyName; // The original credited party name is the bank
        const bankAccountRegex = /(\d+)\s+(.*)/;
        const match = bankAccountNumberRaw.match(bankAccountRegex);
        if (match) {
            creditedPartyAccountNo = match[1].trim();
            creditedPartyName = match[2].trim();
        }
    }


    return {
        payerName: getTextWithFallback("የከፋይ ስም/Payer Name"),
        payerTelebirrNo: getTextWithFallback("የከፋይ ቴሌብር ቁ./Payer telebirr no."),
        creditedPartyName,
        creditedPartyAccountNo,
        transactionStatus: getTextWithFallback("የክፍያው ሁኔታ/transaction status"),
        receiptNo: getReceiptNo(),
        paymentDate: getPaymentDate(),
        settledAmount: getSettledAmount(),
        serviceFee: getServiceFee(),
        serviceFeeVAT: getTextWithFallback("የአገልግሎት ክፍያ ተ.እ.ታ/Service fee VAT"),
        totalPaidAmount: getTextWithFallback("ጠቅላላ የተከፈለ/Total Paid Amount"),
        bankName,
        customerNote: getTextWithFallback("የደንበኛ መልዕክት/Customer Note")
    };
}

const PRIMARY_RECEIPT_URL = 'https://transactioninfo.ethiotelecom.et/receipt/';
const FETCH_TIMEOUT_MS = Number(
    process.env.TELEBIRR_FETCH_TIMEOUT_MS ||
    process.env.VERIFIER_API_TIMEOUT_MS ||
    90000
);
const MAX_FETCH_RETRIES = Math.max(0, Number(process.env.TELEBIRR_FETCH_RETRIES ?? 2));
const SUCCESS_KEYWORDS = /\b(success|successful|paid|transaction|confirmed|completed|settled)\b/i;
const DEFAULT_FALLBACK_PROXY_URLS = ['https://leul.et/verify.php?reference='];

const TELEBIRR_HTTP_HEADERS = {
    Accept: 'text/html,application/xhtml+xml,application/xml,application/json,text/plain,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

export type TelebirrErrorCode = 'not_found' | 'network' | 'invalid_response';

export class TelebirrVerificationError extends Error {
    public code: TelebirrErrorCode;
    public details?: string;

    constructor(message: string, code: TelebirrErrorCode, details?: string) {
        super(message);
        this.name = 'TelebirrVerificationError';
        this.code = code;
        this.details = details;
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function responseBodyToString(data: unknown): string {
    if (data == null) return '';
    if (typeof data === 'string') return data;
    if (Buffer.isBuffer(data)) return data.toString('utf8');
    if (typeof data === 'object') {
        try {
            return JSON.stringify(data);
        } catch {
            return String(data);
        }
    }
    return String(data);
}

function logTelebirrRawResponse(source: string, reference: string, raw: unknown): void {
    const text = responseBodyToString(raw);
    const preview = text.length > 4000 ? `${text.slice(0, 4000)}…[truncated]` : text;
    console.log('TELEBIRR RAW RESPONSE:', { source, reference, length: text.length, preview });
    logger.info(`[Telebirr] raw response from ${source}`, {
        reference,
        length: text.length,
        preview: preview.slice(0, 500),
    });
}

function hasSuccessKeywords(raw: string): boolean {
    return SUCCESS_KEYWORDS.test(raw);
}

function isSuccessStatusLike(status: string): boolean {
    const s = String(status || '').trim().toLowerCase();
    if (!s) return false;
    return /\b(success|successful|completed|complete|paid|settled|confirmed|approved)\b/i.test(s);
}

function mapJsonFieldsToReceipt(data: Record<string, unknown>): TelebirrReceipt {
    return {
        payerName: String(data.payerName || ''),
        payerTelebirrNo: String(data.payerTelebirrNo || ''),
        creditedPartyName: String(data.creditedPartyName || ''),
        creditedPartyAccountNo: String(data.creditedPartyAccountNo || ''),
        transactionStatus: String(data.transactionStatus || ''),
        receiptNo: String(data.receiptNo || ''),
        paymentDate: String(data.paymentDate || ''),
        settledAmount: String(data.settledAmount || ''),
        serviceFee: String(data.serviceFee || ''),
        serviceFeeVAT: String(data.serviceFeeVAT || ''),
        totalPaidAmount: String(data.totalPaidAmount || data.totalAmount || ''),
        bankName: String(data.bankName || ''),
        customerNote: String(data.customerNote || ''),
    };
}

/**
 * Parses Telebirr receipt data from JSON response (flexible shapes).
 */
function parseTelebirrJson(jsonData: any, reference = ''): TelebirrReceipt | null {
    try {
        if (!jsonData || typeof jsonData !== 'object') {
            return null;
        }

        if (jsonData.success === false && jsonData.error) {
            logger.warn('Proxy JSON reported failure', { error: jsonData.error });
            return null;
        }

        if (typeof jsonData.html === 'string' && jsonData.html.length > 0) {
            return parseTelebirrResponse(jsonData.html, reference);
        }

        if (jsonData.data && typeof jsonData.data === 'object') {
            const receipt = mapJsonFieldsToReceipt(jsonData.data);
            if (isValidReceipt(receipt)) return receipt;
            if (hasSuccessKeywords(JSON.stringify(jsonData.data))) {
                return normalizePartialReceipt(receipt, reference);
            }
        }

        if (jsonData.receiptNo || jsonData.settledAmount || jsonData.payerName || jsonData.transactionStatus) {
            const receipt = mapJsonFieldsToReceipt(jsonData);
            if (isValidReceipt(receipt)) return receipt;
        }

        return null;
    } catch (error) {
        logger.error('Error parsing JSON from proxy endpoint', { error, jsonData });
        return null;
    }
}

function normalizePartialReceipt(receipt: TelebirrReceipt, reference: string): TelebirrReceipt {
    const normalized = { ...receipt };

    if (!normalized.receiptNo && reference) {
        normalized.receiptNo = reference;
    }

    if (!normalized.transactionStatus && (normalized.settledAmount || normalized.totalPaidAmount)) {
        normalized.transactionStatus = 'Successful';
    } else if (!normalized.transactionStatus) {
        normalized.transactionStatus = 'Confirmed';
    }

    if (!normalized.settledAmount && normalized.totalPaidAmount) {
        normalized.settledAmount = normalized.totalPaidAmount;
    }

    return normalized;
}

function buildReceiptFromKeywords(raw: string, reference: string): TelebirrReceipt | null {
    if (!hasSuccessKeywords(raw)) {
        return null;
    }

    const scraped = scrapeTelebirrReceipt(raw);
    if (isValidReceipt(scraped, raw)) {
        return normalizePartialReceipt(scraped, reference);
    }

    const settledAmount = extractSettledAmountRegex(raw) || '';
    const receiptNo = extractReceiptNoRegex(raw) || reference;
    const paymentDate = extractDateRegex(raw) || '';

    if (!settledAmount && !receiptNo) {
        return null;
    }

    return normalizePartialReceipt(
        {
            payerName: scraped.payerName || '',
            payerTelebirrNo: scraped.payerTelebirrNo || '',
            creditedPartyName: scraped.creditedPartyName || '',
            creditedPartyAccountNo: scraped.creditedPartyAccountNo || '',
            transactionStatus: scraped.transactionStatus || 'Successful',
            receiptNo,
            paymentDate,
            settledAmount,
            serviceFee: scraped.serviceFee || '',
            serviceFeeVAT: scraped.serviceFeeVAT || '',
            totalPaidAmount: scraped.totalPaidAmount || settledAmount,
            bankName: scraped.bankName || '',
            customerNote: scraped.customerNote || '',
        },
        reference
    );
}

/**
 * Unified parser for HTML, JSON, or plain-text Telebirr responses.
 */
function parseTelebirrResponse(raw: unknown, reference: string): TelebirrReceipt | null {
    const text = responseBodyToString(raw).trim();
    if (!text) {
        return null;
    }

    if (text.startsWith('{') || text.startsWith('[')) {
        try {
            const json = JSON.parse(text);
            const fromJson = parseTelebirrJson(json, reference);
            if (fromJson && isValidReceipt(fromJson, text)) {
                return normalizePartialReceipt(fromJson, reference);
            }
        } catch {
            // Not JSON — continue with HTML/text parsing
        }
    }

    const scraped = scrapeTelebirrReceipt(text);
    if (isValidReceipt(scraped, text)) {
        return normalizePartialReceipt(scraped, reference);
    }

    const keywordReceipt = buildReceiptFromKeywords(text, reference);
    if (keywordReceipt && isValidReceipt(keywordReceipt, text)) {
        return keywordReceipt;
    }

    return null;
}

function isValidReceipt(receipt: TelebirrReceipt, rawHint?: string): boolean {
    const hasAmount = Boolean(
        String(receipt.settledAmount || '').trim() || String(receipt.totalPaidAmount || '').trim()
    );
    const hasReceipt = Boolean(String(receipt.receiptNo || '').trim());
    const hasPayer = Boolean(String(receipt.payerName || '').trim());
    const hasStatus = isSuccessStatusLike(receipt.transactionStatus);
    const keywordOk = rawHint ? hasSuccessKeywords(rawHint) : false;

    if (hasAmount && (hasReceipt || hasPayer || hasStatus)) return true;
    if (hasReceipt && (hasAmount || hasStatus || keywordOk)) return true;
    if (hasStatus && (hasAmount || hasReceipt)) return true;
    if (keywordOk && hasAmount) return true;

    return false;
}

function getFallbackProxies(): string[] {
    const envProxies = (process.env.FALLBACK_PROXIES || '')
        .split(',')
        .map((url) => url.trim())
        .filter((url) => url.length > 0);

    if (envProxies.length > 0) {
        return envProxies;
    }

    return DEFAULT_FALLBACK_PROXY_URLS;
}

function isNetworkAxiosError(error: AxiosError): boolean {
    const code = String(error.code || '').toUpperCase();
    return (
        code === 'ETIMEDOUT' ||
        code === 'ECONNABORTED' ||
        code === 'ECONNREFUSED' ||
        code === 'ENOTFOUND' ||
        code === 'EAI_AGAIN' ||
        /timeout|network/i.test(String(error.message || ''))
    );
}

async function axiosGetWithRetries(url: string, source: string, reference: string) {
    let lastNetworkError: AxiosError | null = null;

    for (let attempt = 0; attempt <= MAX_FETCH_RETRIES; attempt++) {
        try {
            if (attempt > 0) {
                logger.warn(`[Telebirr] retry ${attempt}/${MAX_FETCH_RETRIES} for ${source}`, {
                    reference,
                    url,
                });
                await sleep(1200 * attempt);
            }

            const response = await axios.get(url, {
                timeout: FETCH_TIMEOUT_MS,
                headers: TELEBIRR_HTTP_HEADERS,
                responseType: 'text',
                transformResponse: [(data) => data],
                validateStatus: (status) => status >= 200 && status < 500,
            });

            logTelebirrRawResponse(source, reference, response.data);

            if (response.status === 404) {
                return { kind: 'not_found' as const, data: response.data };
            }

            if (response.status >= 400) {
                return { kind: 'invalid_response' as const, data: response.data, status: response.status };
            }

            return { kind: 'ok' as const, data: response.data, status: response.status };
        } catch (error) {
            const axiosError = error as AxiosError;
            if (isNetworkAxiosError(axiosError)) {
                lastNetworkError = axiosError;
                logger.warn(`[Telebirr] network error on ${source} attempt ${attempt + 1}`, {
                    reference,
                    message: axiosError.message,
                    code: axiosError.code,
                });
                continue;
            }

            throw error;
        }
    }

    if (lastNetworkError) {
        throw new TelebirrVerificationError(
            'Telebirr verification timed out or network is unreachable.',
            'network',
            lastNetworkError.message
        );
    }

    throw new TelebirrVerificationError('Telebirr verification request failed.', 'network');
}

type FetchAttemptResult =
    | { kind: 'ok'; data: unknown; status: number }
    | { kind: 'not_found'; data: unknown }
    | { kind: 'invalid_response'; data: unknown; status: number };

async function fetchFromPrimarySource(reference: string, baseUrl: string): Promise<TelebirrReceipt | null> {
    const url = `${baseUrl}${reference}`;
    logger.info(`Attempting to fetch Telebirr receipt from primary source: ${url}`);

    const result: FetchAttemptResult = await axiosGetWithRetries(url, 'primary', reference);

    if (result.kind === 'not_found') {
        logger.warn(`[Telebirr] primary source returned 404 for ${reference}`);
        return null;
    }

    if (result.kind === 'invalid_response') {
        logger.warn(`[Telebirr] primary source returned HTTP ${result.status} for ${reference}`);
        const parsedAnyway = parseTelebirrResponse(result.data, reference);
        if (parsedAnyway) return parsedAnyway;
        return null;
    }

    const parsed = parseTelebirrResponse(result.data, reference);
    if (parsed) {
        logger.info(`Successfully extracted Telebirr data from primary source for ${reference}`, {
            receiptNo: parsed.receiptNo,
            payerName: parsed.payerName,
            transactionStatus: parsed.transactionStatus,
            settledAmount: parsed.settledAmount,
        });
        return parsed;
    }

    logger.warn(`[Telebirr] primary source response could not be parsed for ${reference}`);
    return null;
}

async function fetchFromProxySource(reference: string, proxyUrl: string): Promise<TelebirrReceipt | null> {
    const proxyKey = process.env.TELEBIRR_PROXY_KEY || '';
    const url = `${proxyUrl}${reference}${proxyKey ? `&key=${proxyKey}` : ''}`;

    try {
        logger.info(`Attempting to fetch Telebirr receipt from proxy: ${proxyUrl}`);
        const result = await axiosGetWithRetries(url, `proxy:${proxyUrl}`, reference);

        if (result.kind === 'not_found') {
            return null;
        }

        const raw = result.data;
        const text = responseBodyToString(raw);

        if (text.trim().startsWith('{')) {
            try {
                const json = JSON.parse(text);
                if (json?.success === false && json?.error) {
                    logger.warn(`Proxy returned explicit error: ${json.error}`);
                    return null;
                }
            } catch {
                // fall through to unified parser
            }
        }

        const parsed = parseTelebirrResponse(raw, reference);
        if (parsed) {
            logger.info(`Successfully verified using proxy: ${proxyUrl}`, {
                receiptNo: parsed.receiptNo,
                settledAmount: parsed.settledAmount,
            });
            return parsed;
        }

        logger.warn(`[Telebirr] proxy response could not be parsed: ${proxyUrl}`);
        return null;
    } catch (error) {
        if (error instanceof TelebirrVerificationError) {
            throw error;
        }

        logger.error(`Error fetching Telebirr receipt from proxy ${url}:`, {
            error: error instanceof Error ? error.message : String(error),
        });
        return null;
    }
}

export function telebirrErrorHttpStatus(code: TelebirrErrorCode): number {
    switch (code) {
        case 'network':
            return 504;
        case 'invalid_response':
            return 422;
        case 'not_found':
        default:
            return 404;
    }
}

export async function verifyTelebirr(reference: string): Promise<TelebirrReceipt | null> {
    const trimmedRef = String(reference || '').trim();
    if (!trimmedRef) {
        throw new TelebirrVerificationError('Telebirr reference is required.', 'invalid_response');
    }

    const fallbackProxies = getFallbackProxies();
    const skipPrimary = process.env.SKIP_PRIMARY_VERIFICATION === 'true';
    let sawInvalidResponse = false;
    let sawNetworkError = false;
    let networkMessage = '';

    if (!skipPrimary) {
        logger.info(`Attempting primary verification for: ${trimmedRef}`);
        try {
            const primaryResult = await fetchFromPrimarySource(trimmedRef, PRIMARY_RECEIPT_URL);
            if (primaryResult) {
                return primaryResult;
            }
            sawInvalidResponse = true;
        } catch (error) {
            if (error instanceof TelebirrVerificationError && error.code === 'network') {
                sawNetworkError = true;
                networkMessage = error.message;
            } else {
                throw error;
            }
        }
        logger.warn(`Primary verification failed. Moving to fallback proxy pool...`);
    } else {
        logger.info('Skipping primary verifier (SKIP_PRIMARY_VERIFICATION=true).');
    }

    for (const proxyUrl of fallbackProxies) {
        try {
            const fallbackResult = await fetchFromProxySource(trimmedRef, proxyUrl);
            if (fallbackResult) {
                return fallbackResult;
            }
            sawInvalidResponse = true;
        } catch (error) {
            if (error instanceof TelebirrVerificationError && error.code === 'network') {
                sawNetworkError = true;
                networkMessage = error.message;
                logger.warn(`Proxy ${proxyUrl} network failure. Trying next...`);
                continue;
            }
            logger.warn(`Proxy ${proxyUrl} failed. Trying next...`, {
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    if (sawNetworkError && !sawInvalidResponse) {
        throw new TelebirrVerificationError(
            networkMessage || 'Telebirr verification timed out or network is unreachable.',
            'network'
        );
    }

    if (sawInvalidResponse) {
        throw new TelebirrVerificationError(
            'Telebirr returned a response that could not be parsed into a receipt.',
            'invalid_response'
        );
    }

    throw new TelebirrVerificationError(
        `Telebirr receipt not found for reference: ${trimmedRef}`,
        'not_found'
    );
}