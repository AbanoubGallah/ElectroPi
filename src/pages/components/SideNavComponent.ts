/**
 * App-shell navigation.
 *
 * Shared UI belongs in a component object, not copy-pasted into each page -
 * when the nav is restyled, one file changes.
 */
import type { Locator, Page } from '@playwright/test';
import { logger } from '../../utils/logger.js';

export class SideNavComponent {
  readonly dashboard: Locator;
  readonly inventory: Locator;
  readonly sales: Locator;

  constructor(private readonly page: Page) {
    this.dashboard = page.getByTestId('nav-dashboard');
    this.inventory = page.getByTestId('nav-inventory');
    this.sales = page.getByTestId('nav-sales');
  }

  /**
   * Click-through to the Inventory module.
   *
   * Returns void and leaves page-object construction to the caller's fixture,
   * so navigation helpers never become a hidden factory of page objects.
   */
  async goToInventory(): Promise<void> {
    logger.step('Navigate to the Inventory module');
    await this.inventory.click();
    await this.page.waitForURL(/\/inventory/, { timeout: 15_000 });
  }

  async goToDashboard(): Promise<void> {
    await this.dashboard.click();
    await this.page.waitForURL(/\/dashboard/, { timeout: 15_000 });
  }
}
