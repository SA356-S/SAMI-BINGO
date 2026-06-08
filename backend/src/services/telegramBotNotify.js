const https = require('https');

function postTelegramApi(token, method, body, logLabel = 'telegram') {
  const botToken = String(token || '').trim();
  if (!botToken) {
    console.warn(`[${logLabel}] skipped — missing bot token`);
    return Promise.resolve({ ok: false, error: 'missing_token' });
  }

  const payload = JSON.stringify(body);
  const apiPath = `/bot${botToken}/${method}`;

  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: 'api.telegram.org',
        path: apiPath,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const bodyText = Buffer.concat(chunks).toString('utf8');
          let parsed = {};
          try {
            parsed = JSON.parse(bodyText);
          } catch {
            parsed = { raw: bodyText };
          }

          if (res.statusCode === 200 && parsed.ok) {
            resolve({ ok: true, result: parsed.result });
            return;
          }

          console.warn(`[${logLabel}] ${method} failed`, {
            statusCode: res.statusCode,
            description: parsed.description || parsed.error_code || bodyText,
          });
          resolve({
            ok: false,
            error: parsed.description || bodyText,
            statusCode: res.statusCode,
          });
        });
      }
    );

    req.on('error', (err) => {
      console.warn(`[${logLabel}] ${method} request error:`, err?.message || err);
      resolve({ ok: false, error: err?.message || String(err) });
    });

    req.write(payload);
    req.end();
  });
}

function sendTelegramMessageWithToken(token, chatId, text, logLabel = 'telegram', options = {}) {
  const target = String(chatId || '').trim();
  if (!target || !text) {
    console.warn(`[${logLabel}] sendMessage skipped — missing chatId or text`);
    return Promise.resolve(false);
  }

  const body = {
    chat_id: target,
    text: String(text),
    ...options,
  };

  return postTelegramApi(token, 'sendMessage', body, logLabel).then((res) => res.ok);
}

function sendTelegramMessage(chatId, text) {
  return sendTelegramMessageWithToken(
    process.env.BOT_TOKEN,
    chatId,
    text,
    'telegram'
  );
}

/** Withdraw admin alerts — must use WITHDRAW_BOT_TOKEN only. */
function sendWithdrawBotMessage(chatId, text, replyMarkup = null) {
  const token = String(process.env.WITHDRAW_BOT_TOKEN || '').trim();
  if (!token) {
    console.warn('[withdraw-bot] WITHDRAW_BOT_TOKEN is not set');
    return Promise.resolve({ ok: false, error: 'missing_token' });
  }

  const options = replyMarkup ? { reply_markup: replyMarkup } : {};
  return postTelegramApi(
    token,
    'sendMessage',
    {
      chat_id: String(chatId),
      text: String(text),
      ...options,
    },
    'withdraw-bot'
  );
}

function editWithdrawBotMessage(chatId, messageId, text, replyMarkup = null) {
  const token = String(process.env.WITHDRAW_BOT_TOKEN || '').trim();
  if (!token) {
    return Promise.resolve({ ok: false, error: 'missing_token' });
  }

  const body = {
    chat_id: String(chatId),
    message_id: Number(messageId),
    text: String(text),
  };
  if (replyMarkup) {
    body.reply_markup = replyMarkup;
  }

  return postTelegramApi(token, 'editMessageText', body, 'withdraw-bot');
}

module.exports = {
  sendTelegramMessage,
  sendWithdrawBotMessage,
  editWithdrawBotMessage,
  postTelegramApi,
};
