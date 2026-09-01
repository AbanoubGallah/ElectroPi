import { expect, type Locator, type Page, type Response } from '@playwright/test';
import { BasePage } from './BasePage.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

export interface ProductFormInput {
  name: string;
  price: string;
  sku?: string;
  quantity?: string;
  category?: string;
}

/**
 * Inventory module: product grid + "New product" modal.
 *
 * The page object exposes *behaviour* and *locators*; it does not assert
 * business outcomes. Tests own the assertions, so the same page object serves
 * a happy path and a validation test without growing conditionals.
 */
export class InventoryPage extends BasePage {
  protected readonly path = '/inventory.html';

  // grid
  readonly loadingSpinner: Locator;
  readonly table: Locator;
  readonly rows: Locator;
  readonly emptyState: Locator;
  readonly addProductButton: Locator;

  // modal
  readonly modal: Locator;
  readonly productName: Locator;
  readonly productPrice: Locator;
  readonly productSku: Locator;
  readonly productQuantity: Locator;
  readonly productCategory: Locator;
  readonly saveButton: Locator;
  readonly cancelButton: Locator;

  constructor(page: Page) {
    super(page);
    this.loadingSpinner = page.getByTestId('inventory-loading');
    this.table = page.getByTestId('inventory-table');
    this.rows = page.getByTestId('inventory-row');
    this.emptyState = page.getByTestId('inventory-empty');
    this.addProductButton = page.getByTestId('add-product-btn');

    this.modal = page.getByTestId('product-modal');
    this.productName = page.getByTestId('product-name');
    this.productPrice = page.getByTestId('product-price');
    this.productSku = page.getByTestId('product-sku');
    this.productQuantity = page.getByTestId('product-quantity');
    this.productCategory = page.getByTestId('product-category');
    this.saveButton = page.getByTestId('product-save');
    this.cancelButton = page.getByTestId('product-cancel');
  }

  /**
   * Readiness for an async-rendered grid, expressed as three observable facts:
   *   spinner gone -> data arrived -> the primary action is enabled.
   *
   * The third condition is the one that matters. The app enables "Add product"
   * only after BOTH /inventory/items and /categories resolve, so waiting on it
   * removes the entire class of "clicked too early" failures - with no sleep,
   * and without coupling the test to a request count.
   */
  override async waitUntilReady(): Promise<void> {
    await expect(this.loadingSpinner).toBeHidden({ timeout: env.timeouts.action });
    await expect(this.addProductButton).toBeEnabled({ timeout: env.timeouts.action });
  }

  /** Opens the modal and waits until the form is genuinely fillable. */
  async openNewProductForm(): Promise<void> {
    logger.step('Open the New Product form');
    await this.addProductButton.click();
    await expect(this.modal).toBeVisible();
    await expect(this.productName).toBeEditable();
    // The category <select> is populated asynchronously; it stays disabled until
    // its options land. Waiting on "enabled" is the readiness signal for the form.
    await expect(this.productCategory).toBeEnabled({ timeout: env.timeouts.action });
  }

  async fillProductForm(input: ProductFormInput): Promise<void> {
    logger.step(`Fill product form: name="${input.name}", price="${input.price}"`);
    await this.productName.fill(input.name);
    await this.productPrice.fill(input.price);
    if (input.sku !== undefined) await this.productSku.fill(input.sku);
    if (input.quantity !== undefined) await this.productQuantity.fill(input.quantity);
    if (input.category !== undefined) {
      await this.productCategory.selectOption({ label: input.category });
    }
  }

  /**
   * Clicks Save and waits for the request to settle.
   *
   * `waitForResponse` is registered *before* the click so the listener cannot
   * miss a fast response - a subtle ordering bug that shows up as a 1-in-20 flake.
   * Awaiting the response (not a timeout) is what makes this deterministic.
   */
  async save(): Promise<Response> {
    const responsePromise = this.page.waitForResponse(
      (response) =>
        response.url().includes('/api/v1/inventory/items') && response.request().method() === 'POST',
      { timeout: env.timeouts.action },
    );
    await this.saveButton.click();
    const response = await responsePromise;
    logger.info(`POST /inventory/items -> ${response.status()}`);
    return response;
  }

  /** Composite action for tests that only care about the end state. */
  async createProduct(input: ProductFormInput): Promise<Response> {
    await this.openNewProductForm();
    await this.fillProductForm(input);
    return this.save();
  }

  /** Grid row for a product, located by its business key rather than by index. */
  rowBySku(sku: string): Locator {
    return this.rows.filter({ has: this.page.getByTestId('cell-sku').getByText(sku, { exact: true }) });
  }

  /** Grid row located by product name - index-free, so parallel runs stay safe. */
  rowByName(name: string): Locator {
    return this.page.getByTestId('inventory-row').filter({ hasText: name });
  }

  /** Inline validation message for a given payload field. */
  fieldError(field: 'item_name' | 'price' | 'sku' | 'quantity' | 'category_id'): Locator {
    return this.page.getByTestId(`error-${field}`);
  }
}
