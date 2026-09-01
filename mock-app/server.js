/**
 * Electro Pi POS - mock application under test.
 *
 * Exists so the framework in this repository is *executable* by anyone who
 * clones it: no staging environment, no VPN, no seeded database required.
 * It deliberately reproduces the traits that make the real product hard to
 * test, so the waiting/stability strategies in the framework are exercised
 * for real rather than being decorative:
 *
 *   - multi-tenancy       -> every record and token is tenant-scoped
 *   - async data render   -> tables/selects arrive via fetch, behind a spinner
 *   - network latency     -> configurable artificial delay (LATENCY_MS)
 *   - optimistic UI       -> the Save button is disabled while in flight
 *   - transient toasts    -> success toast auto-dismisses after 4s
 *   - RBAC               -> cashiers get 403 on inventory writes
 *
 * Pure Node core modules only - nothing to install beyond Playwright.
 */
import { createServer } from 'node:http';
import { createHmac, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, 'public');

const PORT = Number(process.env.PORT ?? 4173);
const HOST = process.env.HOST ?? '127.0.0.1';
const LATENCY_MS = Number(process.env.LATENCY_MS ?? 350);
const TOKEN_SECRET = process.env.TOKEN_SECRET ?? 'local-only-not-a-real-secret';
const TOKEN_TTL_MS = 15 * 60 * 1000;

/* ------------------------------------------------------------------ data --- */

const users = [
  { id: 'u-1', email: 'admin@alpha-store.io', password: 'Passw0rd!', role: 'STORE_ADMIN', tenant_id: 'tenant-alpha', name: 'Alpha Admin' },
  { id: 'u-2', email: 'cashier@alpha-store.io', password: 'Passw0rd!', role: 'CASHIER', tenant_id: 'tenant-alpha', name: 'Alpha Cashier' },
  { id: 'u-3', email: 'admin@beta-store.io', password: 'Passw0rd!', role: 'STORE_ADMIN', tenant_id: 'tenant-beta', name: 'Beta Admin' },
];

/** categories are tenant-scoped; id 3 = Electronics, as per the assessment payload */
const categories = [
  { id: 1, name: 'Groceries', tenant_id: 'tenant-alpha' },
  { id: 2, name: 'Apparel', tenant_id: 'tenant-alpha' },
  { id: 3, name: 'Electronics', tenant_id: 'tenant-alpha' },
  { id: 3, name: 'Electronics', tenant_id: 'tenant-beta' },
  { id: 9, name: 'Beta Only', tenant_id: 'tenant-beta' },
];

/** @type {Map<string, object>} id -> item */
const items = new Map();

const WRITE_ROLES = new Set(['STORE_ADMIN', 'OWNER']);

/* ----------------------------------------------------------------- tokens --- */

const sign = (payloadB64) => createHmac('sha256', TOKEN_SECRET).update(payloadB64).digest('base64url');

function issueToken(user) {
  const payload = { sub: user.id, email: user.email, role: user.role, tenant_id: user.tenant_id, exp: Date.now() + TOKEN_TTL_MS };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body)}`;
}

/** @returns {{ok: true, claims: object} | {ok: false, reason: 'malformed'|'signature'|'expired'}} */
function verifyToken(token) {
  const [body, signature] = String(token).split('.');
  if (!body || !signature) return { ok: false, reason: 'malformed' };
  if (sign(body) !== signature) return { ok: false, reason: 'signature' };
  let claims;
  try {
    claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (typeof claims.exp !== 'number' || claims.exp < Date.now()) return { ok: false, reason: 'expired' };
  return { ok: true, claims };
}

/* ------------------------------------------------------------------ http --- */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function send(res, status, body, headers = {}) {
  const payload = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, {
    // A bodyless response (204) must not advertise a content type.
    ...(body === undefined ? {} : { 'content-type': 'application/json; charset=utf-8' }),
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(payload);
}

const fail = (res, status, code, message, details) =>
  send(res, status, { error: { code, message, ...(details ? { details } : {}) } });

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return { ok: true, value: {} };
  try {
    const value = JSON.parse(raw);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false };
    }
    return { ok: true, value };
  } catch {
    return { ok: false };
  }
}

/** Bearer auth guard. Returns claims, or writes the failure response and returns null. */
function authenticate(req, res) {
  const header = req.headers.authorization ?? '';
  if (!header.startsWith('Bearer ') || header.slice(7).trim() === '') {
    fail(res, 401, 'UNAUTHENTICATED', 'Authorization header with a Bearer token is required.');
    return null;
  }
  const result = verifyToken(header.slice(7).trim());
  if (!result.ok) {
    const message = result.reason === 'expired' ? 'Access token has expired.' : 'Access token is invalid.';
    fail(res, 401, result.reason === 'expired' ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID', message);
    return null;
  }
  return result.claims;
}

/* ------------------------------------------------------------ validation --- */

const MAX_PRICE = 1_000_000;

/** Field-level validation mirroring the documented contract. @returns {Array<{field: string, issue: string}>} */
function validateItemPayload(payload, tenantId) {
  const details = [];
  const { item_name, sku, quantity, price, category_id } = payload;

  if (item_name === undefined || item_name === null || String(item_name).trim() === '') {
    details.push({ field: 'item_name', issue: 'REQUIRED' });
  } else if (typeof item_name !== 'string') {
    details.push({ field: 'item_name', issue: 'MUST_BE_STRING' });
  } else if (item_name.trim().length > 120) {
    details.push({ field: 'item_name', issue: 'MAX_LENGTH_120' });
  }

  if (sku === undefined || sku === null || String(sku).trim() === '') {
    details.push({ field: 'sku', issue: 'REQUIRED' });
  } else if (typeof sku !== 'string' || !/^[A-Z0-9][A-Z0-9-]{1,31}$/i.test(sku)) {
    details.push({ field: 'sku', issue: 'INVALID_FORMAT' });
  }

  if (quantity === undefined || quantity === null) {
    details.push({ field: 'quantity', issue: 'REQUIRED' });
  } else if (typeof quantity !== 'number' || !Number.isInteger(quantity)) {
    details.push({ field: 'quantity', issue: 'MUST_BE_INTEGER' });
  } else if (quantity < 0) {
    details.push({ field: 'quantity', issue: 'MUST_BE_GTE_0' });
  }

  if (price === undefined || price === null) {
    details.push({ field: 'price', issue: 'REQUIRED' });
  } else if (typeof price !== 'number' || Number.isNaN(price)) {
    details.push({ field: 'price', issue: 'MUST_BE_NUMBER' });
  } else if (price < 0) {
    details.push({ field: 'price', issue: 'MUST_BE_GTE_0' });
  } else if (price > MAX_PRICE) {
    details.push({ field: 'price', issue: 'MAX_1000000' });
  } else if (Math.round(price * 100) !== Number((price * 100).toFixed(4))) {
    details.push({ field: 'price', issue: 'MAX_2_DECIMALS' });
  }

  if (category_id === undefined || category_id === null) {
    details.push({ field: 'category_id', issue: 'REQUIRED' });
  } else if (typeof category_id !== 'number' || !Number.isInteger(category_id)) {
    details.push({ field: 'category_id', issue: 'MUST_BE_INTEGER' });
  } else if (!categories.some((c) => c.id === category_id && c.tenant_id === tenantId)) {
    // Tenant-scoped: a category that exists for another tenant is still unknown here.
    details.push({ field: 'category_id', issue: 'NOT_FOUND' });
  }

  return details;
}

const toItemResponse = (item) => ({
  id: item.id,
  item_name: item.item_name,
  sku: item.sku,
  quantity: item.quantity,
  price: item.price,
  category_id: item.category_id,
  category_name: categories.find((c) => c.id === item.category_id && c.tenant_id === item.tenant_id)?.name ?? null,
  tenant_id: item.tenant_id,
  created_at: item.created_at,
  created_by: item.created_by,
});

/* ---------------------------------------------------------------- routing --- */

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

async function serveStatic(res, urlPath) {
  const rel = urlPath === '/' ? '/login.html' : urlPath;
  const safe = normalize(rel).replace(/^(\.\.[/\\])+/, '');
  const file = join(PUBLIC_DIR, safe);
  if (!file.startsWith(PUBLIC_DIR)) return fail(res, 403, 'FORBIDDEN', 'Path traversal blocked.');
  try {
    const content = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(content);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('Not found');
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  const path = url.pathname;
  const method = req.method ?? 'GET';

  // ---- health: used by CI to wait for readiness instead of sleeping --------
  if (path === '/health') return send(res, 200, { status: 'ok', uptime_s: Math.round(process.uptime()) });

  // ---- test-support hooks: deterministic reset between specs --------------
  if (path === '/api/v1/test-support/reset' && method === 'POST') {
    items.clear();
    return send(res, 200, { status: 'reset' });
  }

  if (path.startsWith('/api/')) {
    await sleep(LATENCY_MS);

    // ---- POST /api/v1/auth/login ------------------------------------------
    if (path === '/api/v1/auth/login' && method === 'POST') {
      const body = await readJsonBody(req);
      if (!body.ok) return fail(res, 400, 'MALFORMED_JSON', 'Request body is not valid JSON.');
      const { email, password } = body.value;
      const user = users.find((u) => u.email === String(email ?? '').toLowerCase().trim() && u.password === password);
      if (!user) return fail(res, 401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
      return send(res, 200, {
        access_token: issueToken(user),
        token_type: 'Bearer',
        expires_in: TOKEN_TTL_MS / 1000,
        user: { id: user.id, name: user.name, email: user.email, role: user.role, tenant_id: user.tenant_id },
      });
    }

    // ---- GET /api/v1/categories -------------------------------------------
    if (path === '/api/v1/categories' && method === 'GET') {
      const claims = authenticate(req, res);
      if (!claims) return;
      return send(res, 200, {
        data: categories.filter((c) => c.tenant_id === claims.tenant_id).map(({ id, name }) => ({ id, name })),
      });
    }

    // ---- POST /api/v1/inventory/items -------------------------------------
    if (path === '/api/v1/inventory/items' && method === 'POST') {
      const claims = authenticate(req, res);
      if (!claims) return;

      if (!WRITE_ROLES.has(claims.role)) {
        return fail(res, 403, 'FORBIDDEN', `Role ${claims.role} lacks the inventory:write permission.`);
      }

      const body = await readJsonBody(req);
      if (!body.ok) return fail(res, 400, 'MALFORMED_JSON', 'Request body is not valid JSON.');

      const details = validateItemPayload(body.value, claims.tenant_id);
      if (details.length > 0) {
        return fail(res, 422, 'VALIDATION_ERROR', 'One or more fields are invalid.', details);
      }

      const sku = String(body.value.sku).toUpperCase();
      const duplicate = [...items.values()].some((i) => i.tenant_id === claims.tenant_id && i.sku === sku);
      if (duplicate) {
        return fail(res, 409, 'DUPLICATE_SKU', `SKU ${sku} already exists for this store.`);
      }

      const item = {
        id: randomUUID(),
        item_name: String(body.value.item_name).trim(),
        sku,
        quantity: body.value.quantity,
        price: Number(body.value.price.toFixed(2)),
        category_id: body.value.category_id,
        tenant_id: claims.tenant_id,
        created_by: claims.sub,
        created_at: new Date().toISOString(),
      };
      items.set(item.id, item);
      return send(res, 201, toItemResponse(item), { location: `/api/v1/inventory/items/${item.id}` });
    }

    // ---- GET /api/v1/inventory/items (tenant-scoped list) ------------------
    if (path === '/api/v1/inventory/items' && method === 'GET') {
      const claims = authenticate(req, res);
      if (!claims) return;
      const sku = url.searchParams.get('sku');
      const data = [...items.values()]
        .filter((i) => i.tenant_id === claims.tenant_id)
        .filter((i) => (sku ? i.sku === sku.toUpperCase() : true))
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map(toItemResponse);
      return send(res, 200, { data, meta: { total: data.length, tenant_id: claims.tenant_id } });
    }

    // ---- GET/DELETE /api/v1/inventory/items/:id ---------------------------
    const byId = path.match(/^\/api\/v1\/inventory\/items\/([^/]+)$/);
    if (byId && (method === 'GET' || method === 'DELETE')) {
      const claims = authenticate(req, res);
      if (!claims) return;
      const item = items.get(byId[1]);
      // Cross-tenant reads are 404, never 403: existence itself must not leak.
      if (!item || item.tenant_id !== claims.tenant_id) {
        return fail(res, 404, 'ITEM_NOT_FOUND', 'Inventory item not found.');
      }
      if (method === 'DELETE') {
        if (!WRITE_ROLES.has(claims.role)) return fail(res, 403, 'FORBIDDEN', `Role ${claims.role} lacks inventory:write.`);
        items.delete(item.id);
        return send(res, 204);
      }
      return send(res, 200, toItemResponse(item));
    }

    return fail(res, 404, 'ROUTE_NOT_FOUND', `No route for ${method} ${path}`);
  }

  if (method !== 'GET') {
    res.writeHead(405, { 'content-type': 'text/plain' });
    return res.end('Method Not Allowed');
  }
  return serveStatic(res, path);
});

server.listen(PORT, HOST, () => {
  console.log(`[mock-app] Electro Pi POS listening on http://${HOST}:${PORT} (latency ${LATENCY_MS}ms)`);
});
