/**
 * Part 2.1 - POST /api/v1/inventory/items
 *
 * The two positive and three negative scenarios from the written answers,
 * executable. Extra cases (403, 400, tenant isolation) are included because
 * this endpoint is a write path on a multi-tenant platform: authorisation and
 * tenant scoping are not "nice to have" coverage, they are the risk.
 *
 * Each test asserts three things, not one:
 *   status code  ->  the contract
 *   body/shape   ->  the payload the client will actually consume
 *   side effect  ->  what the database now holds (via a follow-up read)
 * A test that only checks the status code passes against an endpoint that
 * returns 201 and stores nothing.
 */
import { test, expect } from '../../src/fixtures/test-fixtures.js';
import { env } from '../../src/config/env.js';
import { anItem } from '../../src/data/products.js';
import type { ErrorEnvelope, InventoryItem } from '../../src/api/types.js';

test.describe('POST /api/v1/inventory/items', () => {
  // ------------------------------------------------------------- positive ---

  test('TC-API-01 valid payload creates the item and returns 201 @smoke @api', async ({
    inventoryApi,
    adminToken,
    cleanup,
  }) => {
    const payload = anItem({ item_name: 'Wireless Mouse', quantity: 50, price: 25.0 });

    const response = await inventoryApi.createItem(payload, adminToken);

    expect(response.status()).toBe(201);
    /* A 201 must tell the client where the resource lives. */
    expect(response.headers()['location']).toContain('/api/v1/inventory/items/');

    const created = (await response.json()) as InventoryItem;
    cleanup.push(created.id);

    expect(created).toMatchObject({
      item_name: payload.item_name,
      sku: payload.sku,
      quantity: payload.quantity,
      price: payload.price,
      category_id: payload.category_id,
      category_name: env.electronicsCategory.name,
      tenant_id: env.tenantId,
    });
    /* Shape checks: the client relies on these types, so pin them down. */
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Number.isInteger(created.quantity)).toBe(true);
    expect(typeof created.price).toBe('number');
    expect(new Date(created.created_at).toString()).not.toBe('Invalid Date');

    /* Persistence check - the point of the test. */
    const readBack = await inventoryApi.getItem(created.id, adminToken);
    expect(readBack.status()).toBe(200);
    expect((await readBack.json()) as InventoryItem).toMatchObject({ sku: payload.sku, price: payload.price });
  });

  test('TC-API-02 boundary values are accepted (quantity 0, minimum price, max-length name) @api', async ({
    inventoryApi,
    adminToken,
    cleanup,
  }) => {
    const payload = anItem({
      item_name: 'B'.repeat(120), // exactly at the documented 120-char limit
      quantity: 0, // zero stock is legitimate: a pre-order or an out-of-stock line
      price: 0.01, // smallest chargeable amount
    });

    const response = await inventoryApi.createItem(payload, adminToken);

    expect(response.status()).toBe(201);
    const created = (await response.json()) as InventoryItem;
    cleanup.push(created.id);
    expect(created.quantity).toBe(0);
    expect(created.price).toBe(0.01);
    expect(created.item_name).toHaveLength(120);
  });

  // ------------------------------------------------------------- negative ---

  test('TC-API-03 a request without a valid bearer token is rejected with 401 @security @api', async ({
    inventoryApi,
  }) => {
    const cases = [
      { label: 'no Authorization header', token: undefined, code: 'UNAUTHENTICATED' },
      { label: 'a tampered token', token: 'not-a-real-token', code: 'TOKEN_INVALID' },
    ];

    for (const { label, token, code } of cases) {
      await test.step(`rejects ${label}`, async () => {
        const response = await inventoryApi.createItem(anItem(), token);
        expect(response.status()).toBe(401);
        expect(((await response.json()) as ErrorEnvelope).error.code).toBe(code);
      });
    }
  });

  test('TC-API-04 invalid field values are rejected with 422 and a field-level reason @api', async ({
    inventoryApi,
    adminToken,
  }) => {
    /* Data-driven: one table row per rule. Adding a rule is a one-line change,
       which is what keeps validation coverage from rotting. */
    const cases: Array<{ label: string; payload: Record<string, unknown>; field: string; issue: string }> = [
      { label: 'item_name missing', payload: { ...anItem(), item_name: undefined }, field: 'item_name', issue: 'REQUIRED' },
      { label: 'item_name blank', payload: { ...anItem(), item_name: '   ' }, field: 'item_name', issue: 'REQUIRED' },
      { label: 'sku missing', payload: { ...anItem(), sku: undefined }, field: 'sku', issue: 'REQUIRED' },
      { label: 'sku with illegal characters', payload: { ...anItem(), sku: 'MS 001!' }, field: 'sku', issue: 'INVALID_FORMAT' },
      { label: 'negative quantity', payload: { ...anItem(), quantity: -5 }, field: 'quantity', issue: 'MUST_BE_GTE_0' },
      { label: 'fractional quantity', payload: { ...anItem(), quantity: 2.5 }, field: 'quantity', issue: 'MUST_BE_INTEGER' },
      { label: 'negative price', payload: { ...anItem(), price: -25.0 }, field: 'price', issue: 'MUST_BE_GTE_0' },
      { label: 'price as a string', payload: { ...anItem(), price: '25.00' }, field: 'price', issue: 'MUST_BE_NUMBER' },
      { label: 'price with 3 decimals', payload: { ...anItem(), price: 25.005 }, field: 'price', issue: 'MAX_2_DECIMALS' },
      { label: 'unknown category_id', payload: { ...anItem(), category_id: 999_999 }, field: 'category_id', issue: 'NOT_FOUND' },
    ];

    for (const { label, payload, field, issue } of cases) {
      await test.step(`422 when ${label}`, async () => {
        const response = await inventoryApi.createItem(payload, adminToken);

        expect(response.status(), `${label} should be rejected`).toBe(422);
        const body = (await response.json()) as ErrorEnvelope;
        expect(body.error.code).toBe('VALIDATION_ERROR');
        /* Assert the *specific* field and reason: a generic 422 assertion would
           pass even if the API blamed the wrong field, which is how bad error
           messages reach production. */
        expect(body.error.details).toEqual(
          expect.arrayContaining([expect.objectContaining({ field, issue })]),
        );
      });
    }
  });

  test('TC-API-05 a duplicate SKU within the same store is rejected with 409 @api', async ({
    inventoryApi,
    adminToken,
    cleanup,
  }) => {
    const payload = anItem();

    const first = await inventoryApi.createItem(payload, adminToken);
    expect(first.status()).toBe(201);
    cleanup.push(((await first.json()) as InventoryItem).id);

    const duplicate = await inventoryApi.createItem(payload, adminToken);

    expect(duplicate.status()).toBe(409);
    const body = (await duplicate.json()) as ErrorEnvelope;
    expect(body.error.code).toBe('DUPLICATE_SKU');
    expect(body.error.message).toContain(payload.sku);

    /* And no phantom second record was written. */
    const matching = await inventoryApi.listItems(adminToken, { sku: payload.sku });
    expect((await matching.json()).data).toHaveLength(1);
  });

  // ------------------------------- authorisation and tenancy (write path) ---

  test('TC-API-06 a Cashier cannot create inventory items (403, not 401) @security @api', async ({
    inventoryApi,
    cashierToken,
  }) => {
    const response = await inventoryApi.createItem(anItem(), cashierToken);

    /* 403 rather than 401 is the correct contract: the caller is authenticated
       but not authorised. Confusing the two breaks client retry logic. */
    expect(response.status()).toBe(403);
    expect(((await response.json()) as ErrorEnvelope).error.code).toBe('FORBIDDEN');
  });

  test('TC-API-07 a malformed JSON body is rejected with 400, not 500 @api', async ({
    inventoryApi,
    adminToken,
  }) => {
    const response = await inventoryApi.createItemWithRawBody('{"item_name": "Broken",', adminToken);

    expect(response.status()).toBe(400);
    expect(((await response.json()) as ErrorEnvelope).error.code).toBe('MALFORMED_JSON');
  });

  test('TC-API-08 an item created by one merchant is invisible to another @security @api', async ({
    inventoryApi,
    authApi,
    adminToken,
    cleanup,
  }) => {
    const created = await inventoryApi.seedItem(anItem(), adminToken);
    cleanup.push(created.id);

    const otherTenantToken = await authApi.tokenFor(env.users.otherTenantAdmin);
    const crossTenantRead = await inventoryApi.getItem(created.id, otherTenantToken);

    /* 404, deliberately - a 403 would confirm the record exists and leak
       another merchant's data volume. */
    expect(crossTenantRead.status()).toBe(404);

    const otherTenantList = await inventoryApi.listAll(otherTenantToken);
    expect(otherTenantList.data.map((i) => i.id)).not.toContain(created.id);
  });
});
