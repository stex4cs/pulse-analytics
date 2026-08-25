'use client';

/**
 * Klijent za Pulse Dashboard API.
 * Cuva access + refresh token u localStorage i tiho osvezava access token.
 */

import { IS_DEMO, DEMO_USER, demoResponse } from './demo.js';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8081';
const ACCESS = 'pulse_access';
const REFRESH = 'pulse_refresh';
const USER = 'pulse_user';

export const tokens = {
  // U demo rezimu nema tokena jer nema backenda; vracamo oznaku da bi
  // zasticeni layout pustio prikaz.
  get access() { return IS_DEMO ? 'demo' : safeGet(ACCESS); },
  get refresh() { return IS_DEMO ? null : safeGet(REFRESH); },
  get user() {
    if (IS_DEMO) return DEMO_USER;
    const raw = safeGet(USER);
    try { return raw ? JSON.parse(raw) : null; } catch { return null; }
  },
  set(data) {
    safeSet(ACCESS, data.accessToken);
    safeSet(REFRESH, data.refreshToken);
    safeSet(USER, JSON.stringify(data.user));
  },
  clear() {
    [ACCESS, REFRESH, USER].forEach((k) => safeSet(k, null));
  },
};

function safeGet(key) {
  try { return typeof window !== 'undefined' ? window.localStorage.getItem(key) : null; } catch { return null; }
}
function safeSet(key, value) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch { /* privatni rezim */ }
}

let refreshing = null;

async function refreshAccess() {
  if (refreshing) return refreshing;
  const token = tokens.refresh;
  if (!token) return null;

  refreshing = fetch(`${BASE}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: token }),
  })
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      if (data) tokens.set(data);
      return data;
    })
    .catch(() => null)
    .finally(() => { refreshing = null; });

  return refreshing;
}

export async function apiFetch(path, options = {}) {
  // Demo se presece OVDE, pre ijednog mreznog poziva - nijedan zahtev ne
  // napusta pregledac, pa API ne mora ni da postoji ni da bude izlozen.
  if (IS_DEMO) {
    await new Promise((r) => setTimeout(r, 120));   // blaga latencija radi realnosti
    return demoResponse(path);
  }

  const doFetch = async () => fetch(`${BASE}/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(tokens.access ? { Authorization: `Bearer ${tokens.access}` } : {}),
      ...(options.headers ?? {}),
    },
  });

  let res = await doFetch();

  if (res.status === 401 && tokens.refresh) {
    const refreshed = await refreshAccess();
    if (refreshed) res = await doFetch();
  }

  if (res.status === 401) {
    tokens.clear();
    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
      window.location.href = '/login';
    }
    throw new Error('Sesija je istekla');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Greška ${res.status}`);
  }

  return res.json();
}

export const fetcher = (path) => apiFetch(path);

export async function login(email, password) {
  if (IS_DEMO) return DEMO_USER;

  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Prijava nije uspela');
  tokens.set(data);
  return data.user;
}

export async function logout() {
  if (IS_DEMO) {
    if (typeof window !== 'undefined') window.location.href = '/login';
    return;
  }
  try { await apiFetch('/auth/logout', { method: 'POST' }); } catch { /* svejedno cistimo */ }
  tokens.clear();
  if (typeof window !== 'undefined') window.location.href = '/login';
}

/** Preuzimanje CSV-a uz Authorization zaglavlje. */
export async function downloadCsv(path, filename) {
  if (IS_DEMO) {
    alert('CSV export radi u punoj verziji. Ovo je demo bez backenda.');
    return;
  }

  const res = await fetch(`${BASE}/api${path}`, {
    headers: tokens.access ? { Authorization: `Bearer ${tokens.access}` } : {},
  });
  if (!res.ok) throw new Error('Export nije uspeo');

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
