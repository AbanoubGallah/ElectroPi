/**
 * Part 1.3 - the requested end-to-end flow:
 *   log in as Store Admin -> Inventory module -> fill Product Name + Price
 *   -> Save -> assert the success toast.
 *
 * The first test mirrors those five steps literally, one `test.step` each, so
 * the HTML report reads like the test case it came from. The tests after it are
 * the ones that make the feature actually covered rather than merely demoed.
 */
import { test, expect } from '../../src/fixtures/test-fixtures.js';
import { env } from '../../src/config/env.js';
import { aProductForm } from '../../src/data/products.js';
import type { InventoryItem } from '../../src/api/types.js';

test.describe('Inventory - create product', () => {
  /* This spec's subject IS the login screen, so it must not inherit a session. */
  test.use({ storageState: { cookies: [], origins: [] } });

  test(
    'Store Admin can create a product and sees a success toast @smoke @regression',
    async ({ loginPage, inventoryPage, cleanup }) => {
      const product = aProductForm();

      await test.step('Log in as a Store Admin', async () => {
        await loginPage.open();
        await loginPage.loginAs(env.users.storeAdmin);
      });

      await test.step("Navigate to the 'Inventory' module", async () => {
        await inventoryPage.nav.goToInventory();
        // Readiness gate: spinner gone + "Add product" enabled (both fetches done).
        await inventoryPage.waitUntilReady();
      });

      await test.step("Fill in the 'Product Name' and 'Price'", async () => {
        await inventoryPage.openNewProductForm();
        await inventoryPage.fillProductForm({ name: product.name, price: product.price });
      });

      const response = await test.step("Click 'Save'", async () => {
        return inventoryPage.save();
      });

      await test.step('Assert that a success toast message appears', async () => {
        await inventoryPage.toast.expectSuccess(/saved successfully/i);
      });

      /* Beyond the brief, but this is what makes the test trustworthy: the toast
         is a UI promise; the 201 and the grid row are the evidence it was kept. */
      await test.step('Verify the API accepted it and the grid reflects it', async () => {
        expect(response.status()).toBe(201);
        const created = (await response.json()) as InventoryItem;
        cleanup.push(created.id);

        expect(created).toMatchObject({
          item_name: product.name,
          price: Number(product.price),
          tenant_id: env.tenantId,
          category_name: env.electronicsCategory.name,
        });
        await expect(inventoryPage.rowByName(product.name)).toBeVisible();
      });
    },
  );

  test('a created product survives a page reload (it was persisted, not just rendered) @regression', async ({
    loginPage,
    inventoryPage,
    cleanup,
    page,
  }) => {
    const product = aProductForm();

    await loginPage.open();
    await loginPage.loginAs(env.users.storeAdmin);
    await inventoryPage.nav.goToInventory();
    await inventoryPage.waitUntilReady();

    const response = await inventoryPage.createProduct({ name: product.name, price: product.price });
    expect(response.status()).toBe(201);
    cleanup.push(((await response.json()) as InventoryItem).id);
    await inventoryPage.toast.expectSuccess();

    /* Optimistic UIs happily show a row that was never stored. Reload proves it. */
    await page.reload({ waitUntil: 'domcontentloaded' });
    await inventoryPage.waitUntilReady();
    await expect(inventoryPage.rowByName(product.name)).toBeVisible();
  });
});

test.describe('Inventory - validation and permissions', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('price is required: saving without it shows an inline error and no row is added @regression', async ({
    inventoryAsAdmin,
  }) => {
    const rowsBefore = await inventoryAsAdmin.rows.count();

    await inventoryAsAdmin.openNewProductForm();
    await inventoryAsAdmin.fillProductForm({ name: 'Item with no price', price: '' });
    const response = await inventoryAsAdmin.save();

    expect(response.status()).toBe(422);
    await expect(inventoryAsAdmin.fieldError('price')).toBeVisible();
    await expect(inventoryAsAdmin.fieldError('price')).toContainText(/required/i);
    await inventoryAsAdmin.toast.expectError(/correct the highlighted fields/i);

    /* The modal must stay open with the user's input intact - losing it is a bug. */
    await expect(inventoryAsAdmin.modal).toBeVisible();
    await expect(inventoryAsAdmin.productName).toHaveValue('Item with no price');
    expect(await inventoryAsAdmin.rows.count()).toBe(rowsBefore);
  });

  test('a negative price is rejected @regression', async ({ inventoryAsAdmin }) => {
    await inventoryAsAdmin.openNewProductForm();
    await inventoryAsAdmin.fillProductForm({ name: 'Negative price probe', price: '-1' });

    expect((await inventoryAsAdmin.save()).status()).toBe(422);
    await expect(inventoryAsAdmin.fieldError('price')).toContainText(/negative/i);
  });

  test('duplicate SKU is rejected with a clear message @regression', async ({
    inventoryAsAdmin,
    inventoryApi,
    adminToken,
    cleanup,
  }) => {
    /* Seed the conflicting item over the API: faster and unambiguous, and the
       test stays focused on the *UI behaviour* of the conflict. */
    const seeded = await inventoryApi.seedItem(
      { item_name: 'Seeded mouse', sku: `DUP-${Date.now().toString(36).toUpperCase()}`, quantity: 5, price: 10, category_id: env.electronicsCategory.id },
      adminToken,
    );
    cleanup.push(seeded.id);

    await inventoryAsAdmin.openNewProductForm();
    await inventoryAsAdmin.fillProductForm({ name: 'Another mouse', price: '12.50', sku: seeded.sku });

    expect((await inventoryAsAdmin.save()).status()).toBe(409);
    await inventoryAsAdmin.toast.expectError(/already exists/i);
    await expect(inventoryAsAdmin.fieldError('sku')).toBeVisible();
  });

  test('the success toast is transient and clears itself @regression', async ({
    inventoryAsAdmin,
    cleanup,
  }) => {
    const product = aProductForm();
    const response = await inventoryAsAdmin.createProduct({ name: product.name, price: product.price });
    cleanup.push(((await response.json()) as InventoryItem).id);

    await inventoryAsAdmin.toast.expectSuccess();
    /* Asserting the disappearance too: a toast that sticks forever covers the
       grid, and `toBeHidden` polls rather than sleeping for the 4s timer. */
    await inventoryAsAdmin.toast.expectSuccessToDismiss();
  });
});
