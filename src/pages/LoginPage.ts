import { expect, type Locator, type Page } from '@playwright/test';
import { BasePage } from './BasePage.js';
import { env, type TestUser } from '../config/env.js';
import { logger } from '../utils/logger.js';

/**
 * Sign-in screen.
 *
 * Selector policy, in priority order:
 *   1. `data-testid`  - contract-style hooks the app team owns and won't restyle away
 *   2. role/label     - user-visible semantics (`getByRole`, `getByLabel`)
 *   3. CSS structure   - last resort only
 * Never XPath and never a generated class such as `.css-1x3fh9`, which is the
 * single biggest source of flakiness in a component-driven UI.
 */
export class LoginPage extends BasePage {
  protected readonly path = '/login.html';

  readonly form: Locator;
  readonly email: Locator;
  readonly password: Locator;
  readonly submit: Locator;
  readonly errorAlert: Locator;

  constructor(page: Page) {
    super(page);
    this.form = page.getByTestId('login-form');
    this.email = page.getByTestId('login-email');
    this.password = page.getByTestId('login-password');
    this.submit = page.getByTestId('login-submit');
    this.errorAlert = page.getByTestId('login-error');
  }

  override async waitUntilReady(): Promise<void> {
    // "Ready" means the form can actually accept input - not that the DOM parsed.
    await expect(this.email).toBeEditable({ timeout: env.timeouts.action });
    await expect(this.submit).toBeEnabled();
  }

  /**
   * Signs in and waits for the post-login landing page.
   *
   * The `waitForURL` is the deterministic handoff: the test continues only once
   * the SPA has actually committed the navigation, so no test needs to guess
   * how long the auth round-trip takes.
   */
  async loginAs(user: TestUser): Promise<void> {
    logger.step(`Sign in as ${user.role} (${user.email})`);
    await this.email.fill(user.email);
    await this.password.fill(user.password);
    await this.submit.click();
    await this.page.waitForURL(/\/dashboard/, { timeout: env.timeouts.navigation });
  }

  /** Submits credentials without expecting success - used by negative tests. */
  async attemptLogin(email: string, password: string): Promise<void> {
    await this.email.fill(email);
    await this.password.fill(password);
    await this.submit.click();
  }
}
