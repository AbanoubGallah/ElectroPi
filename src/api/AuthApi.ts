import type { APIRequestContext } from '@playwright/test';
import { env, type TestUser } from '../config/env.js';
import type { LoginResponse } from './types.js';

/**
 * Authentication service client.
 *
 * Tokens are obtained through the API, never through the UI, when the test's
 * subject is not the login screen itself. That removes the slowest and most
 * brittle step from every other test in the suite.
 */
export class AuthApi {
  constructor(private readonly request: APIRequestContext) {}

  async login(user: TestUser): Promise<LoginResponse> {
    const response = await this.request.post(`${env.apiBaseURL}/auth/login`, {
      data: { email: user.email, password: user.password },
    });
    if (!response.ok()) {
      throw new Error(
        `Login failed for ${user.email}: ${response.status()} ${await response.text()}`,
      );
    }
    return (await response.json()) as LoginResponse;
  }

  /** Convenience: just the bearer token. */
  async tokenFor(user: TestUser): Promise<string> {
    return (await this.login(user)).access_token;
  }

  /** Raw response, for negative auth tests that assert on the failure itself. */
  async attemptLogin(email: string, password: string) {
    return this.request.post(`${env.apiBaseURL}/auth/login`, { data: { email, password } });
  }
}
