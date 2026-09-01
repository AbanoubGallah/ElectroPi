/**
 * Custom fixtures - the seam that keeps the specs declarative.
 *
 * A test asks for what it needs (`{ inventoryPage, adminToken }`) and Playwright
 * builds it. Three properties follow from that:
 *
 *   - No `beforeEach` chains: setup is per-test and composable.
 *   - Guaranteed teardown: every item a test creates is deleted afterwards even
 *     when the test fails, so a red run never poisons the next one.
 *   - Cheap auth: the store-admin token is worker-scoped, so the suite logs in
 *     once per worker instead of once per test.
 */
import { test as base, expect, type APIRequestContext } from '@playwright/test';
import { LoginPage } from '../pages/LoginPage.js';
import { InventoryPage } from '../pages/InventoryPage.js';
import { AuthApi } from '../api/AuthApi.js';
import { InventoryApi } from '../api/InventoryApi.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

interface TestFixtures {
  loginPage: LoginPage;
  inventoryPage: InventoryPage;
  authApi: AuthApi;
  inventoryApi: InventoryApi;
  /** Item ids pushed here are deleted in teardown. */
  cleanup: string[];
  /** A signed-in Store Admin already sitting on the Inventory page. */
  inventoryAsAdmin: InventoryPage;
}

interface WorkerFixtures {
  /** Worker-scoped: one login per worker process, reused by every test in it. */
  adminToken: string;
  cashierToken: string;
  workerRequest: APIRequestContext;
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  // ---------------------------------------------------------------- worker ---
  workerRequest: [
    async ({ playwright }, use) => {
      const context = await playwright.request.newContext();
      await use(context);
      await context.dispose();
    },
    { scope: 'worker' },
  ],

  adminToken: [
    async ({ workerRequest }, use) => {
      const token = await new AuthApi(workerRequest).tokenFor(env.users.storeAdmin);
      await use(token);
    },
    { scope: 'worker' },
  ],

  cashierToken: [
    async ({ workerRequest }, use) => {
      const token = await new AuthApi(workerRequest).tokenFor(env.users.cashier);
      await use(token);
    },
    { scope: 'worker' },
  ],

  // ------------------------------------------------------------------ test ---
  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },

  inventoryPage: async ({ page }, use) => {
    await use(new InventoryPage(page));
  },

  authApi: async ({ request }, use) => {
    await use(new AuthApi(request));
  },

  inventoryApi: async ({ request }, use) => {
    await use(new InventoryApi(request));
  },

  /**
   * Teardown that always runs. The `finally`-style contract of a fixture is why
   * cleanup belongs here and not at the end of a test body: a failed assertion
   * aborts the test, but the fixture still unwinds.
   */
  cleanup: async ({ workerRequest, adminToken }, use) => {
    const createdIds: string[] = [];
    await use(createdIds);

    const api = new InventoryApi(workerRequest);
    for (const id of createdIds) {
      const response = await api.deleteItem(id, adminToken);
      if (![204, 404].includes(response.status())) {
        logger.warn(`Cleanup of item ${id} returned ${response.status()}`);
      }
    }
  },

  /**
   * Fast path for tests whose subject is *not* the login screen: authenticate
   * over the API, seed the session into the browser, and land on Inventory.
   * Saves a full UI login (~2s + a network round trip) per test.
   */
  inventoryAsAdmin: async ({ page, workerRequest }, use) => {
    const login = await new AuthApi(workerRequest).login(env.users.storeAdmin);

    await page.addInitScript(
      ([token, user]) => {
        window.localStorage.setItem('ep.access_token', token as string);
        window.localStorage.setItem('ep.user', JSON.stringify(user));
      },
      [login.access_token, login.user] as const,
    );

    const inventory = new InventoryPage(page);
    await inventory.open();
    await use(inventory);
  },
});

export { expect };
