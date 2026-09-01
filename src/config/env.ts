/**
 * Single source of truth for environment configuration.
 *
 * Nothing in the framework reads process.env directly - tests and page objects
 * import `env`. That keeps credentials out of the specs, makes the suite
 * portable across local / staging / pre-prod, and means a missing variable
 * fails fast with a readable message instead of a mystery `undefined` selector.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** Minimal .env loader (no runtime dependency). CI supplies real values as secrets. */
function loadDotEnv(file = '.env'): void {
  const path = resolve(process.cwd(), file);
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (key && process.env[key] === undefined) {
      process.env[key] = rawValue!.replace(/^["']|["']$/g, '');
    }
  }
}
loadDotEnv();

function fromEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(
      `Missing required environment variable "${name}". Copy .env.example to .env, or set it in the CI environment.`,
    );
  }
  return value;
}

export type Role = 'STORE_ADMIN' | 'CASHIER';

export interface TestUser {
  email: string;
  password: string;
  role: Role;
}

const baseURL = fromEnv('BASE_URL', 'http://127.0.0.1:4173');

export const env = {
  baseURL,
  apiBaseURL: fromEnv('API_BASE_URL', `${baseURL}/api/v1`),

  /** The platform is multi-tenant: every assertion is scoped to the tenant under test. */
  tenantId: fromEnv('TENANT_ID', 'tenant-alpha'),

  users: {
    storeAdmin: {
      email: fromEnv('STORE_ADMIN_EMAIL', 'admin@alpha-store.io'),
      password: fromEnv('STORE_ADMIN_PASSWORD', 'Passw0rd!'),
      role: 'STORE_ADMIN',
    } satisfies TestUser,
    cashier: {
      email: fromEnv('CASHIER_EMAIL', 'cashier@alpha-store.io'),
      password: fromEnv('CASHIER_PASSWORD', 'Passw0rd!'),
      role: 'CASHIER',
    } satisfies TestUser,
    /** Admin of a *different* merchant - used to prove tenant isolation. */
    otherTenantAdmin: {
      email: fromEnv('OTHER_TENANT_ADMIN_EMAIL', 'admin@beta-store.io'),
      password: fromEnv('OTHER_TENANT_ADMIN_PASSWORD', 'Passw0rd!'),
      role: 'STORE_ADMIN',
    } satisfies TestUser,
  },

  /** Named waits. Tuned per environment instead of sprinkled through the specs. */
  timeouts: {
    action: 15_000,
    navigation: 30_000,
    expect: 10_000,
    /** Toast is transient (auto-dismisses after 4s) - it must be asserted promptly. */
    toast: 8_000,
  },

  isCI: !!process.env.CI,
  storageStatePath: '.auth/store-admin.json',

  /** Known category, matching the assessment payload (`category_id: 3` = Electronics). */
  electronicsCategory: { id: 3, name: 'Electronics' },
} as const;
