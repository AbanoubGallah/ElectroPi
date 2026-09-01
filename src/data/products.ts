/**
 * Test data factories.
 *
 * Every test builds its own data. Two rules that keep a suite parallel-safe:
 *   1. No shared fixtures between tests - one test's cleanup can never break another's.
 *   2. Unique-by-construction identifiers, so re-runs never collide on the 409 DUPLICATE_SKU path.
 */
import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';

export interface InventoryItemPayload {
  item_name: string;
  sku: string;
  quantity: number;
  price: number;
  category_id: number;
}

/** Short, collision-resistant, and traceable back to the run that created it. */
const uniqueSuffix = (): string => randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();

/**
 * Valid inventory item, overridable per test.
 * `Partial<...>` overrides keep negative tests declarative:
 *   anItem({ price: -5 })  ->  the 422 case, with no duplicated boilerplate.
 */
export function anItem(overrides: Partial<InventoryItemPayload> = {}): InventoryItemPayload {
  const suffix = uniqueSuffix();
  return {
    item_name: `Wireless Mouse ${suffix}`,
    sku: `MS-${suffix}`,
    quantity: 50,
    price: 25.0,
    category_id: env.electronicsCategory.id,
    ...overrides,
  };
}

/** UI-only variant: the form auto-generates the SKU, so the test supplies name + price. */
export function aProductForm(overrides: Partial<{ name: string; price: string }> = {}) {
  return {
    name: `Wireless Mouse ${uniqueSuffix()}`,
    price: '25.00',
    ...overrides,
  };
}
