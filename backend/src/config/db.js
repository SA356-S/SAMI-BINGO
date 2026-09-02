const dns = require('dns');

// Atlas SRV lookups fail when Node uses a broken local resolver (127.0.0.1).
dns.setServers(['8.8.8.8', '1.1.1.1']);

const mongoose = require('mongoose');

function getMongoUri() {
  const uri =
    process.env.MONGO_URI ||
    process.env.DATABASE_URL ||
    process.env.MONGODB_URI;

  return typeof uri === 'string' ? uri.trim() : '';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getConnectOptions() {
  // Mongoose 8+ — useNewUrlParser / useUnifiedTopology are built-in (no longer needed).
  return {
    serverSelectionTimeoutMS:
      Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS) || 30000,
    connectTimeoutMS: Number(process.env.MONGO_CONNECT_TIMEOUT_MS) || 30000,
    socketTimeoutMS: Number(process.env.MONGO_SOCKET_TIMEOUT_MS) || 45000,
    maxPoolSize: Number(process.env.MONGO_MAX_POOL_SIZE) || 25,
    minPoolSize: 1,
    maxIdleTimeMS: 60000,
    heartbeatFrequencyMS: 10000,
  };
}

function isRetryableMongoError(err) {
  const message = err?.message ?? String(err);
  return /MongoNetworkError|MongoServerSelectionError|connection.*closed|ETIMEDOUT|ECONNRESET|ENOTFOUND|EAI_AGAIN|socket hang up/i.test(
    message
  );
}

async function disconnectIfPartial() {
  const state = mongoose.connection.readyState;
  if (state === 0) return;
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
}

async function connectOnce(uri, options) {
  await disconnectIfPartial();
  await mongoose.connect(uri, options);
  return mongoose.connection;
}

async function connectWithRetries(uri, options) {
  const maxAttempts = Math.max(
    1,
    Number(process.env.MONGO_CONNECT_RETRIES) || 5
  );
  const baseDelayMs = Number(process.env.MONGO_CONNECT_RETRY_DELAY_MS) || 2000;

  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await connectOnce(uri, options);
    } catch (err) {
      lastErr = err;
      const retryable = isRetryableMongoError(err);
      if (!retryable || attempt === maxAttempts) {
        throw err;
      }
      const delay = baseDelayMs * attempt;
      console.warn(
        `[db] connection attempt ${attempt}/${maxAttempts} failed (${err.message}); retrying in ${delay}ms`
      );
      await sleep(delay);
    }
  }
  throw lastErr;
}

/**
 * Connect to MongoDB via Mongoose. Throws if MONGO_URI is missing or all retries fail.
 */
async function connectDatabase() {
  const uri = getMongoUri();

  if (!uri) {
    const err = new Error(
      'MONGO_URI is not set. Add it to backend/.env or your host environment variables.'
    );
    console.error('[db]', err.message);
    throw err;
  }

  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  mongoose.set('strictQuery', true);

  const options = getConnectOptions();
  const directUri = (process.env.MONGO_URI_DIRECT || '').trim();

  try {
    await connectWithRetries(uri, options);
    console.log('[db] MongoDB connected:', mongoose.connection.host);
    return mongoose.connection;
  } catch (err) {
    const srvDnsFailure =
      uri.startsWith('mongodb+srv://') &&
      /querySrv|ECONNREFUSED|ENOTFOUND/i.test(err.message);

    if (srvDnsFailure && directUri) {
      console.warn('[db] SRV lookup failed; retrying with MONGO_URI_DIRECT');
      try {
        await connectWithRetries(directUri, options);
        console.log('[db] MongoDB connected (direct URI):', mongoose.connection.host);
        return mongoose.connection;
      } catch (retryErr) {
        console.error('[db] MongoDB connection failed (direct URI):', retryErr.message);
        throw retryErr;
      }
    }

    console.error('[db] MongoDB connection failed:', err.message);
    if (err.message.includes('authentication failed')) {
      console.error(
        '[db] Check username/password in MONGO_URI. URL-encode special characters in the password.'
      );
    }
    if (/connection.*closed|MongoNetworkError/i.test(err.message)) {
      console.error(
        '[db] Network closed the connection. Check Atlas IP whitelist, VPN/firewall, and that MONGO_URI uses a standard mongodb:// URI with ssl=true for Atlas.'
      );
    }
    if (srvDnsFailure) {
      console.error(
        '[db] SRV DNS lookup failed. Use a standard mongodb:// URI from Atlas (Connect → Drivers → “Standard connection string”), or set MONGO_URI_DIRECT.'
      );
    }
    throw err;
  }
}

mongoose.connection.on('disconnected', () => {
  console.warn('[db] MongoDB disconnected');
});

mongoose.connection.on('reconnected', () => {
  console.log('[db] MongoDB reconnected');
});

mongoose.connection.on('error', (err) => {
  console.error('[db] MongoDB connection error:', err.message);
});

module.exports = { connectDatabase, getMongoUri, mongoose };
