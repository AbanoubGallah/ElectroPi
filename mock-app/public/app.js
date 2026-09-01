/** Shared front-end helpers for the mock POS app. */
const TOKEN_KEY = 'ep.access_token';
const USER_KEY = 'ep.user';

export const Session = {
  save(payload) {
    localStorage.setItem(TOKEN_KEY, payload.access_token);
    localStorage.setItem(USER_KEY, JSON.stringify(payload.user));
  },
  token: () => localStorage.getItem(TOKEN_KEY),
  user() {
    try { return JSON.parse(localStorage.getItem(USER_KEY) ?? 'null'); } catch { return null; }
  },
  clear() { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); },
};

/** Redirects to login when there is no session. Returns the user when there is. */
export function requireSession() {
  const user = Session.user();
  if (!Session.token() || !user) {
    location.replace('/login.html');
    return null;
  }
  return user;
}

/** Thin fetch wrapper that attaches the bearer token and normalises errors. */
export async function api(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (auth && Session.token()) headers.authorization = `Bearer ${Session.token()}`;
  const res = await fetch(`/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw Object.assign(new Error(json?.error?.message ?? res.statusText), { status: res.status, payload: json });
  return json;
}

/** Success/error toast. Transient by design: it removes itself after 4s. */
export function showToast(message, variant = 'success') {
  const host = document.querySelector('[data-testid="toast-container"]');
  const el = document.createElement('div');
  el.className = `toast ${variant}`;
  el.setAttribute('role', variant === 'error' ? 'alert' : 'status');
  el.setAttribute('data-testid', `toast-${variant}`);
  el.textContent = message;
  host.append(el);
  setTimeout(() => el.remove(), 4000);
}

export const money = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
