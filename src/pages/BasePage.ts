/**
 * BasePage - the shared contract every page object honours.
 *
 * Two deliberate choices:
 *
 * 1. Locators are *declared*, never *resolved*, in the constructor. A Playwright
 *    Locator is a lazy query, so it is re-evaluated on every use. That is what
 *    survives a React re-render: nothing is holding a stale element handle.
 *
 * 2. `waitUntilReady()` is abstract. Every page defines its own semantic
 *    readiness signal (spinner gone, grid painted, primary action enabled).
 *    Readiness is a property of the page, not a number of milliseconds - which
 *    is why there is no `sleep()` anywhere in this framework.
 */
import type { Locator, Page } from '@playwright/test';
import { ToastComponent } from './components/ToastComponent.js';
import { SideNavComponent } from './components/SideNavComponent.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

export abstract class BasePage {
  /** Route this page lives at, relative to baseURL. */
  protected abstract readonly path: string;

  readonly toast: ToastComponent;
  readonly nav: SideNavComponent;
  readonly tenantBadge: Locator;

  constructor(protected readonly page: Page) {
    this.toast = new ToastComponent(page);
    this.nav = new SideNavComponent(page);
    this.tenantBadge = page.getByTestId('tenant-badge');
  }

  /** Resolves once the page is genuinely usable, not merely loaded. */
  abstract waitUntilReady(): Promise<void>;

  async open(): Promise<void> {
    logger.step(`Open ${this.constructor.name} at ${this.path}`);
    // `domcontentloaded` + an explicit readiness gate, never `networkidle`:
    // a POS dashboard polls, so "no requests for 500ms" may never happen.
    await this.page.goto(this.path, {
      waitUntil: 'domcontentloaded',
      timeout: env.timeouts.navigation,
    });
    await this.waitUntilReady();
  }

  /** Tenant currently rendered in the shell - asserted by multi-tenancy tests. */
  async currentTenant(): Promise<string> {
    return (await this.tenantBadge.innerText()).split('·').pop()?.trim() ?? '';
  }
}
