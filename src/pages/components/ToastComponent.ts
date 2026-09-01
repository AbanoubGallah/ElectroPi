/**
 * Toast notifications.
 *
 * Modelled as a component rather than duplicated on every page, because the
 * toast host is part of the app shell.
 *
 * The important detail: this toast auto-dismisses after 4 seconds. So the
 * assertion helper waits for it to be *visible* and reads the text in the same
 * web-first assertion - it never does `waitFor()` then `innerText()`, which is
 * the classic race that makes toast assertions flaky.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { env } from '../../config/env.js';

export class ToastComponent {
  readonly container: Locator;
  readonly success: Locator;
  readonly error: Locator;

  constructor(private readonly page: Page) {
    this.container = page.getByTestId('toast-container');
    this.success = page.getByTestId('toast-success');
    this.error = page.getByTestId('toast-error');
  }

  /** Asserts a success toast appears and (optionally) contains `text`. */
  async expectSuccess(text?: string | RegExp): Promise<void> {
    await expect(this.success, 'a success toast should be shown').toBeVisible({
      timeout: env.timeouts.toast,
    });
    if (text !== undefined) {
      await expect(this.success).toContainText(text, { timeout: env.timeouts.toast });
    }
  }

  async expectError(text?: string | RegExp): Promise<void> {
    await expect(this.error, 'an error toast should be shown').toBeVisible({
      timeout: env.timeouts.toast,
    });
    if (text !== undefined) {
      await expect(this.error).toContainText(text, { timeout: env.timeouts.toast });
    }
  }

  /** Used to prove a toast is transient - i.e. the UI cleans up after itself. */
  async expectSuccessToDismiss(): Promise<void> {
    await expect(this.success).toBeHidden({ timeout: 10_000 });
  }
}
