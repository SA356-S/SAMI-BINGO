const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const KEYS = [
  'MINI_APP_URL',
  'RAILWAY_PUBLIC_DOMAIN',
  'RAILWAY_STATIC_URL',
  'RENDER_EXTERNAL_URL',
  'CORS_ORIGIN',
];

const saved = {};

beforeEach(() => {
  for (const key of KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] == null) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

test('Play button uses Railway public domain instead of a stale onrender Mini App URL', () => {
  process.env.MINI_APP_URL = 'https://bingo-server-6.onrender.com';
  process.env.RAILWAY_PUBLIC_DOMAIN = 'edil-bingo-production.up.railway.app';
  delete require.cache[require.resolve('../src/config/miniAppUrl')];
  const { getMiniAppUrl } = require('../src/config/miniAppUrl');
  assert.equal(getMiniAppUrl(), 'https://edil-bingo-production.up.railway.app');
});

test('Play button uses Railway public domain instead of an ngrok Mini App URL', () => {
  process.env.MINI_APP_URL = 'https://slit-mandate-frayed.ngrok-free.dev';
  process.env.RAILWAY_PUBLIC_DOMAIN = 'edil-bingo-production.up.railway.app';
  delete require.cache[require.resolve('../src/config/miniAppUrl')];
  const { getMiniAppUrl } = require('../src/config/miniAppUrl');
  assert.equal(getMiniAppUrl(), 'https://edil-bingo-production.up.railway.app');
});

test('custom Mini App domain is kept when it is not a legacy host', () => {
  process.env.MINI_APP_URL = 'https://play.capitalbingo.example';
  process.env.RAILWAY_PUBLIC_DOMAIN = 'edil-bingo-production.up.railway.app';
  delete require.cache[require.resolve('../src/config/miniAppUrl')];
  const { getMiniAppUrl } = require('../src/config/miniAppUrl');
  assert.equal(getMiniAppUrl(), 'https://play.capitalbingo.example');
});
