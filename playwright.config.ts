import { defineConfig, devices } from '@playwright/test';
import { env } from './src/config/env.js';

/**
 * Playwright configuration for the Electro Pi POS suite.
 *
 * Two projects, deliberately separated so the pipeline can run them at
 * different stages (API on every commit, UI after deploy - see the CI section
 * of the assessment answers):
 *
 *   api          - no browser, ~seconds, runs first as the fast quality gate
 *   ui-chromium  - browser flows, runs against a deployed environment
 *
 * `webServer` boots the bundled mock POS app, so `npx playwright test` works on
 * a fresh clone with no environment to provision. Point BASE_URL at staging to
 * run the identical suite there.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,

  /* A .only left in a spec silently shrinks CI coverage - fail the build instead. */
  forbidOnly: !!env.isCI,

  /*
   * One retry in CI only. Retries are a *diagnostic*, not a fix: a test that
   * passes on retry is reported as "flaky", which is the signal used to triage
   * it. Locally there are no retries, so flakiness surfaces while it is cheap
   * to fix rather than being masked.
   */
  retries: env.isCI ? 1 : 0,
  workers: env.isCI ? 4 : undefined,

  timeout: 60_000,
  expect: { timeout: env.timeouts.expect },

  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    /* JUnit XML is what GitHub Actions / GitLab / Jenkins parse into test tabs. */
    ['junit', { outputFile: 'reports/junit.xml' }],
  ],

  use: {
    baseURL: env.baseURL,

    /* `getByTestId` resolves data-testid: stable, app-owned hooks. */
    testIdAttribute: 'data-testid',

    /*
     * Debuggability without paying for it on green runs: a trace is recorded on
     * the first retry, so every CI failure ships with a DOM snapshot timeline,
     * network log and console output that can be replayed locally.
     */
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',

    actionTimeout: env.timeouts.action,
    navigationTimeout: env.timeouts.navigation,
  },

  projects: [
    {
      name: 'api',
      testDir: './tests/api',
      use: { ...devices['Desktop Chrome'], headless: true },
    },
    {
      name: 'ui-chromium',
      testDir: './tests/ui',
      use: { ...devices['Desktop Chrome'] },
    },
    /* Enabled in the nightly pipeline only - see .github/workflows/nightly.yml */
    {
      name: 'ui-webkit',
      testDir: './tests/ui',
      grep: /@cross-browser/,
      use: { ...devices['Desktop Safari'] },
    },
  ],

  /* Boot the app under test, then wait for a real readiness endpoint. */
  webServer: {
    command: 'node mock-app/server.js',
    url: `${env.baseURL}/health`,
    reuseExistingServer: !env.isCI,
    timeout: 30_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
