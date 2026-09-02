import { getPlayerUserId, buildTelegramAuthHeaders } from './playerIdentity';
import { resolveServerUrl } from './resolveServerUrl';

const API_BASE = resolveServerUrl();

function authHeaders() {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...buildTelegramAuthHeaders(),
  };
}

export async function fetchDepositMethods() {
  const res = await fetch(`${API_BASE}/api/deposits/methods`, {
    method: 'GET',
    headers: authHeaders(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(data.message || data.error || 'Failed to load deposit methods');
  }
  return data.methods;
}

export async function submitDeposit({ provider, receivingNumber, reference, amount }) {
  const userId = getPlayerUserId();
  const res = await fetch(`${API_BASE}/api/deposits/verify`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      userId,
      provider,
      receivingNumber,
      reference,
      amount,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    const error = new Error(data.message || 'Deposit verification failed');
    error.code = data.error;
    throw error;
  }
  return data;
}
