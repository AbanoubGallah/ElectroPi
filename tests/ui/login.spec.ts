/** Authentication - the gate every other UI test depends on, so it is covered
 *  explicitly rather than implicitly. */
import { test, expect } from '../../src/fixtures/test-fixtures.js';
import { env } from '../../src/config/env.js';

test.use({ storageState: { cookies: [], origins: [] } });

test('a Store Admin lands on their own tenant workspace @smoke @cross-browser', async ({
  loginPage,
  page,
}) => {
  await loginPage.open();
  await loginPage.loginAs(env.users.storeAdmin);

  await expect(page).toHaveURL(/\/dashboard/);
  /* Multi-tenant platform: asserting the tenant badge catches the worst possible
     regression class - a user seeing another merchant's workspace. */
  await expect(page.getByTestId('tenant-badge')).toContainText(env.tenantId);
});

test('invalid credentials are rejected without leaking which field was wrong @regression', async ({
  loginPage,
  page,
}) => {
  await loginPage.open();
  await loginPage.attemptLogin(env.users.storeAdmin.email, 'WrongPassword!');

  await expect(loginPage.errorAlert).toBeVisible();
  await expect(loginPage.errorAlert).toHaveText(/email or password is incorrect/i);
  await expect(page).toHaveURL(/\/login/);
});

test('an unauthenticated visitor cannot reach the Inventory module @regression', async ({ page }) => {
  await page.goto('/inventory.html', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/login/);
});
